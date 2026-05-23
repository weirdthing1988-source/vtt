// PlayCanvas is loaded globally via a script tag in index.html.  The
// `pc` object is therefore available on the window without needing to
// import it.  We remove the CSS import because the stylesheet is
// already linked directly in index.html.

// Obtain the global PlayCanvas namespace from the window.  In a
// non-module script, referencing `pc` without defining it will fall
// back to the global scope.  However, assigning it explicitly makes
// this behavior clear and future‑proofs the code.
const pc = window.pc;
class SMBVttStarter {
    constructor(canvas) {
        // Board dimensions in grid units.  Initially a square board of 16×16 but
        // adjustable at runtime via the UI.  These values are used to scale the
        // board plane, build the grid texture and clamp movement/panning.
        this.boardWidth = 16;
        this.boardHeight = 16;
        this.moveSpeed = 4.5;
        this.panSpeed = 7;
        this.minZoom = 6;
        this.maxZoom = 18;
        this.tokenPosition = new pc.Vec3(0, 0.55, 0);
        this.targetPosition = new pc.Vec3(0, 0.55, 0);
        this.cameraFocus = new pc.Vec3(0, 0, 0);
        this.keys = new Set();
        this.zoom = 10;
        this.animationTime = 0;
        // State for custom camera and token interactions
        this.isDraggingToken = false;
        this.isRotatingCamera = false;
        this.prevMouseX = 0;
        this.cameraYaw = 0;
        // Drag state for moving height objects on the terra layer
        this.isDraggingHeight = false;
        this.tokenPositionValue = document.querySelector('#token-position');
        this.cameraFocusValue = document.querySelector('#camera-focus');
        this.zoomLevelValue = document.querySelector('#zoom-level');
        this.pickFolderButton = document.querySelector('#pick-folder');
        this.pickFilesButton = document.querySelector('#pick-files');
        this.musicFileInput = document.querySelector('#music-files');
        this.prevTrackButton = document.querySelector('#prev-track');
        this.nextTrackButton = document.querySelector('#next-track');
        this.playlistContainer = document.querySelector('#playlist');
        this.musicStatus = document.querySelector('#music-status');
        this.audioPlayer = document.querySelector('#music-player');
        // Music functionality removed in this build; playlist and audio controls are unused.
        this.playlist = [];
        this.currentTrackIndex = -1;
        // Currently selected paint layer ("hex", "terra", "liquid", "props").  The
        // default is "hex" because the grid controller operates on the hex
        // layer.  When another layer is selected the grid controller will
        // disappear.
        this.currentLayer = 'hex';
        this.pendingHeightIndex = null;
        this.heightObjects = [];
        // Indicates whether the height popup is editing a newly created object
        // (which should be deleted if cancelled) or an existing one (which should remain)
        this.isCreatingNewHeight = false;
        this.canvas = canvas;
        this.app = new pc.Application(this.canvas);
        this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
        this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
        this.app.start();
        this.camera = this.createCamera();
        this.createLight();
        this.createBoard();
        this.selectionMarker = this.createSelectionMarker();
        this.token = this.createToken();
        this.bindInput();
        // Music UI has been removed in this build, so do not bind music controls.
        // Bind our custom UI (layer selector, grid control, compass, height button)
        this.bindUi();
        this.updateStats();
        this.app.on('update', (dt) => this.update(dt));
    }
    createCamera() {
        const camera = new pc.Entity('Camera');
        camera.addComponent('camera', {
            clearColor: new pc.Color(0.05, 0.07, 0.12),
            farClip: 100,
            nearClip: 0.1
        });
        this.app.root.addChild(camera);
        camera.setPosition(this.cameraFocus.x, this.zoom, this.cameraFocus.z + this.zoom * 0.82);
        camera.lookAt(this.cameraFocus.x, 0, this.cameraFocus.z);
        return camera;
    }
    createLight() {
        const directional = new pc.Entity('DirectionalLight');
        directional.addComponent('light', {
            type: 'directional',
            intensity: 1.8,
            castShadows: false,
            color: new pc.Color(1, 0.98, 0.94)
        });
        directional.setEulerAngles(50, 35, 0);
        this.app.root.addChild(directional);
        const ambient = this.app.scene.ambientLight;
        ambient.set(0.34, 0.37, 0.44);
    }
    createBoard() {
        // Create the main board plane.  The plane primitive provided by
        // PlayCanvas is oriented in the X/Y plane by default, which means
        // without rotation it acts as a vertical wall.  To lay the board
        // flat on the X/Z plane, we rotate it around the X axis so its
        // normal points upwards.  Additionally, we force this rotation in
        // updateBoardDimensions to prevent it being lost if the scale is
        // modified later.

        const board = new pc.Entity('Board');
        board.addComponent('model', { type: 'plane' });
        // Scale the plane to match the board dimensions.  Use (width, 1, height)
        // so that after a −90° rotation the X and Z axes represent the
        // grid columns and rows respectively, and the Y axis becomes the
        // thickness of the board.  Using a thickness of 1 keeps the board
        // sufficiently thin relative to the camera distance.
        board.setLocalScale(this.boardWidth, 1, this.boardHeight);
        // Rotate so the plane lies flat.  A −90° rotation around the X axis
        // maps the plane’s original Y dimension to the world Z dimension,
        // giving us an X/Z grid with its surface normal pointing upwards.
        board.setLocalEulerAngles(-90, 0, 0);

        // Create a material with a grid texture sized to the current board
        // dimensions.  Using emissive and diffuse maps together prevents
        // lighting from darkening the grid too much.
        const material = new pc.StandardMaterial();
        const gridTexture = this.buildGridTexture(this.boardWidth, this.boardHeight);
        material.diffuseMap = gridTexture;
        material.emissiveMap = gridTexture;
        material.diffuse.set(0.5, 0.54, 0.6);
        material.emissive.set(0.55, 0.6, 0.7);
        material.gloss = 0.15;
        material.useMetalness = false;
        material.update();
        board.model.material = material;
        this.app.root.addChild(board);
        this.board = board;

        // Create a thin rim around the board so the edges are easier to see.
        const rim = new pc.Entity('BoardRim');
        rim.addComponent('model', { type: 'box' });
        rim.setLocalScale(this.boardWidth + 0.35, 0.16, this.boardHeight + 0.35);
        // Position the rim so that its top surface is level with the board plane.
        rim.setLocalPosition(0, -0.12, 0);
        const rimMaterial = new pc.StandardMaterial();
        rimMaterial.diffuse.set(0.09, 0.11, 0.14);
        rimMaterial.emissive.set(0.05, 0.06, 0.08);
        rimMaterial.gloss = 0.2;
        rimMaterial.update();
        rim.model.material = rimMaterial;
        this.app.root.addChild(rim);
        this.boardRim = rim;
    }
    createSelectionMarker() {
        const marker = new pc.Entity('SelectionMarker');
        marker.addComponent('model', { type: 'plane' });
        marker.setLocalEulerAngles(-90, 0, 0);
        marker.setLocalScale(0.95, 1, 0.95);
        marker.setLocalPosition(0, 0.02, 0);
        const material = new pc.StandardMaterial();
        const markerTexture = this.buildMarkerTexture();
        material.diffuseMap = markerTexture;
        material.emissiveMap = markerTexture;
        material.opacityMap = markerTexture;
        material.blendType = pc.BLEND_NORMAL;
        material.alphaTest = 0.1;
        material.diffuse.set(1, 1, 1);
        material.emissive.set(1, 1, 1);
        material.useMetalness = false;
        material.update();
        marker.model.material = material;
        this.app.root.addChild(marker);
        return marker;
    }
    createToken() {
        const token = new pc.Entity('Token');
        token.addComponent('model', { type: 'plane' });
        token.setLocalScale(0.95, 0.95, 0.95);
        token.setLocalPosition(this.tokenPosition);
        const material = new pc.StandardMaterial();
        const tokenTexture = this.buildTokenTexture('SMB');
        material.diffuseMap = tokenTexture;
        material.emissiveMap = tokenTexture;
        material.opacityMap = tokenTexture;
        material.blendType = pc.BLEND_NORMAL;
        material.alphaTest = 0.1;
        material.emissive.set(1, 1, 1);
        material.diffuse.set(1, 1, 1);
        material.useMetalness = false;
        material.update();
        token.model.material = material;
        this.app.root.addChild(token);
        return token;
    }
    bindInput() {
        window.addEventListener('keydown', (event) => {
            this.keys.add(event.key.toLowerCase());
        });
        window.addEventListener('keyup', (event) => {
            this.keys.delete(event.key.toLowerCase());
        });
        this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        this.canvas.addEventListener('pointerdown', (event) => {
            // Always handle middle button rotation
            if (event.button === 1) {
                this.isRotatingCamera = true;
                this.prevMouseX = event.clientX;
                return;
            }
            // If terra layer is active, allow selection and dragging of height objects instead of token
            if (this.currentLayer === 'terra') {
                // Only respond to left button
                if (event.button === 0) {
                    const point = this.toCanvasCoordinates(event.clientX, event.clientY);
                    const worldPoint = this.screenToBoard(point.x, point.y);
                    if (!worldPoint)
                        return;
                    // Attempt to pick an existing height object
                    for (let i = 0; i < this.heightObjects.length; i++) {
                        const obj = this.heightObjects[i];
                        const pos = obj.entity.getPosition();
                        const dx = worldPoint.x - pos.x;
                        const dz = worldPoint.z - pos.z;
                        const distSq = dx * dx + dz * dz;
                        if (distSq <= obj.radius * obj.radius) {
                            // Select this object for editing and dragging
                            this.isDraggingHeight = true;
                            this.pendingHeightIndex = i;
                            // Open the settings popup pre-filled with the object's values
                            this.openHeightPopup(i);
                            return;
                        }
                    }
                    // If no object selected, do nothing on pointerdown (creation is done via button)
                }
                return;
            }
            // Otherwise (hex layer or other), handle token dragging on left button
            if (event.button === 0) {
                this.isDraggingToken = true;
                const point = this.toCanvasCoordinates(event.clientX, event.clientY);
                const worldPoint = this.screenToBoard(point.x, point.y);
                if (worldPoint) {
                    const halfX = this.boardWidth / 2;
                    const halfZ = this.boardHeight / 2;
                    const snappedX = pc.math.clamp(Math.round(worldPoint.x), -halfX, halfX);
                    const snappedZ = pc.math.clamp(Math.round(worldPoint.z), -halfZ, halfZ);
                    this.targetPosition.set(snappedX, this.targetPosition.y, snappedZ);
                    this.selectionMarker.setPosition(snappedX, 0.02, snappedZ);
                    this.updateStats();
                }
            }
        });
        this.canvas.addEventListener('pointermove', (event) => {
            // Handle height object dragging on terra layer
            if (this.isDraggingHeight) {
                const point = this.toCanvasCoordinates(event.clientX, event.clientY);
                const worldPoint = this.screenToBoard(point.x, point.y);
                if (worldPoint && this.pendingHeightIndex !== null) {
                    const objData = this.heightObjects[this.pendingHeightIndex];
                    const halfX = this.boardWidth / 2;
                    const halfZ = this.boardHeight / 2;
                    const snappedX = pc.math.clamp(Math.round(worldPoint.x), -halfX, halfX);
                    const snappedZ = pc.math.clamp(Math.round(worldPoint.z), -halfZ, halfZ);
                    objData.entity.setLocalPosition(snappedX, 0.03, snappedZ);
                }
            }
            // Dragging token on other layers
            if (this.isDraggingToken) {
                const point = this.toCanvasCoordinates(event.clientX, event.clientY);
                const worldPoint = this.screenToBoard(point.x, point.y);
                if (worldPoint) {
                    const halfX = this.boardWidth / 2;
                    const halfZ = this.boardHeight / 2;
                    const snappedX = pc.math.clamp(Math.round(worldPoint.x), -halfX, halfX);
                    const snappedZ = pc.math.clamp(Math.round(worldPoint.z), -halfZ, halfZ);
                    this.targetPosition.set(snappedX, this.targetPosition.y, snappedZ);
                    this.selectionMarker.setPosition(snappedX, 0.02, snappedZ);
                    this.updateStats();
                }
            }
            // Rotating camera
            if (this.isRotatingCamera) {
                const dx = event.clientX - this.prevMouseX;
                this.prevMouseX = event.clientX;
                const angle = dx * 0.005;
                this.cameraYaw += angle;
                this.refreshCamera();
            }
        });
        this.canvas.addEventListener('pointerup', (event) => {
            if (event.button === 0) {
                // Stop dragging either token or height object depending on layer
                if (this.isDraggingHeight) {
                    this.isDraggingHeight = false;
                }
                if (this.isDraggingToken) {
                    this.isDraggingToken = false;
                }
            }
            if (event.button === 1) {
                this.isRotatingCamera = false;
            }
        });
        this.canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            // Adjust camera height (zoom value controls height and distance)
            this.zoom = pc.math.clamp(this.zoom + event.deltaY * 0.05, this.minZoom, this.maxZoom);
            this.refreshCamera();
            this.updateStats();
        }, { passive: false });
    }
    bindMusicUi() {
        this.pickFolderButton.addEventListener('click', async () => {
            await this.loadMusicFromFolder();
        });
        this.pickFilesButton.addEventListener('click', () => {
            this.musicFileInput.click();
        });
        this.musicFileInput.addEventListener('change', () => {
            const files = Array.from(this.musicFileInput.files ?? []);
            if (!files.length) {
                return;
            }
            const tracks = files
                .filter((file) => this.isAudioFile(file.name))
                .map((file) => this.makeTrack(file, file.name));
            this.loadPlaylist(tracks, 'Loaded audio files.');
            this.musicFileInput.value = '';
        });
        this.prevTrackButton.addEventListener('click', () => {
            this.playPreviousTrack();
        });
        this.nextTrackButton.addEventListener('click', () => {
            this.playNextTrack();
        });
        this.audioPlayer.addEventListener('ended', () => {
            this.playNextTrack();
        });
    }
    /**
     * Bind the UI for selecting map layers and adjusting the grid size.  The
     * layer selector consists of a vertical stack of buttons.  Clicking a
     * layer sets it as the current layer and, if the hex layer is
     * selected, reveals the grid controller.  The grid controller
     * overlays four directional buttons on top of a cross-shaped
     * background.  Clicking the directional buttons increases or
     * decreases the board width/height accordingly and updates the
     * dimensions displayed in the centre cell.
     */
    bindLayerUi() {
        const layerButtons = document.querySelectorAll('.layer-btn');
        const gridControl = document.getElementById('grid-control');
        const gridSizeDisplay = document.getElementById('grid-size-display');
        // Highlight the currently active layer and toggle the grid controller
        const updateActiveLayer = (layer) => {
            this.currentLayer = layer;
            layerButtons.forEach((btn) => {
                if (btn.dataset.layer === layer) {
                    btn.classList.add('active');
                }
                else {
                    btn.classList.remove('active');
                }
            });
            if (layer === 'hex') {
                gridControl.classList.remove('hidden');
            }
            else {
                gridControl.classList.add('hidden');
            }
        };
        layerButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const layer = btn.dataset.layer;
                if (!layer)
                    return;
                updateActiveLayer(layer);
            });
        });
        // Initialise the layer selector with hex selected
        updateActiveLayer(this.currentLayer);
        // Update the size display
        const updateSizeDisplay = () => {
            gridSizeDisplay.textContent = `${this.boardWidth}×${this.boardHeight}`;
        };
        updateSizeDisplay();
        // Bind directional buttons on the grid controller
        const dirButtons = gridControl.querySelectorAll('.grid-btn');
        dirButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = btn.dataset.dir;
                if (!dir)
                    return;
                switch (dir) {
                    case 'increase-width':
                        this.updateBoardDimensions(this.boardWidth + 1, this.boardHeight);
                        break;
                    case 'decrease-width':
                        this.updateBoardDimensions(this.boardWidth - 1, this.boardHeight);
                        break;
                    case 'increase-height':
                        this.updateBoardDimensions(this.boardWidth, this.boardHeight + 1);
                        break;
                    case 'decrease-height':
                        this.updateBoardDimensions(this.boardWidth, this.boardHeight - 1);
                        break;
                }
                updateSizeDisplay();
            });
        });
    }
    async loadMusicFromFolder() {
        const pickerWindow = window;
        if (!pickerWindow.showDirectoryPicker) {
            this.setMusicStatus('This browser cannot pick folders directly. Use “Choose Audio Files” instead.', true);
            return;
        }
        try {
            const handle = await pickerWindow.showDirectoryPicker();
            const tracks = await this.collectAudioFiles(handle);
            if (!tracks.length) {
                this.setMusicStatus('No supported audio files were found in that folder.', true);
                return;
            }
            tracks.sort((a, b) => a.path.localeCompare(b.path));
            this.loadPlaylist(tracks, `Loaded ${tracks.length} track${tracks.length === 1 ? '' : 's'} from “${handle.name}”.`);
        }
        catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            this.setMusicStatus('Could not open the selected folder in this browser.', true);
        }
    }
    async collectAudioFiles(handle, prefix = '') {
        const tracks = [];
        for await (const entry of handle.values()) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.kind === 'file' && this.isAudioFile(entry.name)) {
                const file = await entry.getFile();
                tracks.push(this.makeTrack(file, path));
            }
            if (entry.kind === 'directory') {
                tracks.push(...(await this.collectAudioFiles(entry, path)));
            }
        }
        return tracks;
    }
    makeTrack(file, path) {
        return {
            file,
            name: file.name,
            path,
            url: URL.createObjectURL(file)
        };
    }
    loadPlaylist(tracks, status) {
        for (const track of this.playlist) {
            URL.revokeObjectURL(track.url);
        }
        this.playlist = tracks;
        this.currentTrackIndex = tracks.length ? 0 : -1;
        this.renderPlaylist();
        this.setMusicStatus(status);
        if (this.currentTrackIndex >= 0) {
            this.playTrack(this.currentTrackIndex);
        }
    }
    playTrack(index) {
        if (!this.playlist.length) {
            return;
        }
        this.currentTrackIndex = (index + this.playlist.length) % this.playlist.length;
        const track = this.playlist[this.currentTrackIndex];
        this.audioPlayer.src = track.url;
        this.audioPlayer.play().catch(() => {
            this.setMusicStatus(`Loaded “${track.name}”. Press play if your browser blocked autoplay.`);
        });
        this.renderPlaylist();
        this.setMusicStatus(`Now playing: ${track.path}`);
    }
    playNextTrack() {
        if (!this.playlist.length) {
            return;
        }
        this.playTrack(this.currentTrackIndex + 1);
    }
    playPreviousTrack() {
        if (!this.playlist.length) {
            return;
        }
        this.playTrack(this.currentTrackIndex - 1);
    }
    renderPlaylist() {
        if (!this.playlist.length) {
            this.playlistContainer.classList.add('empty');
            this.playlistContainer.textContent = 'No tracks yet.';
            return;
        }
        this.playlistContainer.classList.remove('empty');
        this.playlistContainer.replaceChildren();
        this.playlist.forEach((track, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'track';
            if (index === this.currentTrackIndex) {
                button.classList.add('active');
            }
            button.textContent = track.name;
            const meta = document.createElement('small');
            meta.textContent = track.path;
            button.appendChild(meta);
            button.addEventListener('click', () => this.playTrack(index));
            this.playlistContainer.appendChild(button);
        });
    }
    setMusicStatus(message, isError = false) {
        this.musicStatus.textContent = message;
        this.musicStatus.classList.toggle('error', isError);
    }
    isAudioFile(name) {
        return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name);
    }
    toCanvasCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }
    screenToBoard(x, y) {
        // Assert that the camera component is defined.  PlayCanvas ensures
        // cameras are created with a camera component.
        const cameraComponent = this.camera.camera;
        const near = cameraComponent.screenToWorld(x, y, cameraComponent.nearClip, new pc.Vec3());
        const far = cameraComponent.screenToWorld(x, y, cameraComponent.farClip, new pc.Vec3());
        // Use a loose type for direction so we can call `scale` without
        // upsetting the TypeScript compiler.  PlayCanvas provides scale on
        // Vec3 instances at runtime.
        const direction = far.clone().sub(near);
        if (Math.abs(direction.y) < 0.0001) {
            return null;
        }
        const distance = -near.y / direction.y;
        if (distance < 0) {
            return null;
        }
        return near.clone().add(direction.mulScalar(distance));
    }
    update(dt) {
        // Update the compass orientation each frame
        // Enforce the board orientation on every frame.  Sometimes changing
        // the board scale or other factors can reset the plane’s rotation.
        if (this.board) {
            this.board.setLocalEulerAngles(-90, 0, 0);
        }
        this.updateCompass();
        this.animationTime += dt;
        this.handleKeyboardPan(dt);
        this.moveToken(dt);
        this.billboardToken();
        this.animateSelectionMarker();
        this.updateStats();
    }
    handleKeyboardPan(dt) {
        let moved = false;
        if (this.keys.has('w')) {
            this.cameraFocus.z -= this.panSpeed * dt;
            moved = true;
        }
        if (this.keys.has('s')) {
            this.cameraFocus.z += this.panSpeed * dt;
            moved = true;
        }
        if (this.keys.has('a')) {
            this.cameraFocus.x -= this.panSpeed * dt;
            moved = true;
        }
        if (this.keys.has('d')) {
            this.cameraFocus.x += this.panSpeed * dt;
            moved = true;
        }
        if (moved) {
            // Clamp the camera focus within the current board dimensions.  Use
            // half‑sizes for each axis because the board is centred on the origin.
            const limitX = this.boardWidth / 2;
            const limitZ = this.boardHeight / 2;
            this.cameraFocus.x = pc.math.clamp(this.cameraFocus.x, -limitX, limitX);
            this.cameraFocus.z = pc.math.clamp(this.cameraFocus.z, -limitZ, limitZ);
            this.refreshCamera();
        }
    }
    moveToken(dt) {
        const toTarget = this.targetPosition.clone().sub(this.tokenPosition);
        const distance = toTarget.length();
        if (distance <= 0.001) {
            this.tokenPosition.copy(this.targetPosition);
        }
        else {
            const step = Math.min(distance, this.moveSpeed * dt);
            const dir = toTarget.normalize();
            this.tokenPosition.add(dir.mulScalar(step));
        }
        this.token.setPosition(this.tokenPosition);
    }
    billboardToken() {
        const cameraPosition = this.camera.getPosition();
        const tokenPosition = this.token.getPosition();
        this.token.lookAt(cameraPosition.x, tokenPosition.y, cameraPosition.z);
        this.token.rotateLocal(0, 180, 0);
    }
    animateSelectionMarker() {
        const scale = 0.92 + Math.sin(this.animationTime * 2.6) * 0.05;
        this.selectionMarker.setLocalScale(scale, 1, scale);
    }
    refreshCamera() {
        // Maintain a constant distance from the focus point based on the zoom level.
        const distance = this.zoom * 0.82;
        // Compute offset based on current yaw
        const offsetX = Math.sin(this.cameraYaw) * distance;
        const offsetZ = Math.cos(this.cameraYaw) * distance;
        this.camera.setPosition(this.cameraFocus.x - offsetX, this.zoom, this.cameraFocus.z + offsetZ);
        this.camera.lookAt(this.cameraFocus.x, 0, this.cameraFocus.z);
    }
    updateStats() {
        this.tokenPositionValue.textContent = `(${Math.round(this.tokenPosition.x)}, ${Math.round(this.tokenPosition.z)})`;
        this.cameraFocusValue.textContent = `(${this.cameraFocus.x.toFixed(1)}, ${this.cameraFocus.z.toFixed(1)})`;
        this.zoomLevelValue.textContent = this.zoom.toFixed(1);
    }
    /**
     * Bind the custom UI elements for this build.  This replaces the original
     * layer selection and music UI with a collapsible layer selector, a
     * button for deploying height objects, a WASD compass and a simple
     * settings popup for new height objects.  The grid size controller
     * remains the same and is shown when the hex layer is active.
     */
    bindUi() {
        // Grab references to overlay elements
        this.activeLayerButton = document.getElementById('active-layer');
        this.layerMenu = document.getElementById('layer-menu');
        this.heightButton = document.getElementById('add-height');
        this.compassElement = document.getElementById('compass');
        this.heightPopup = document.getElementById('height-popup');
        this.heightRadiusInput = document.getElementById('height-radius');
        this.heightValueInput = document.getElementById('height-value');
        this.heightApplyButton = document.getElementById('height-apply');
        this.heightCancelButton = document.getElementById('height-cancel');
        // Optional delete button may not exist in earlier markup, so query safely
        this.heightDeleteButton = document.getElementById('height-delete');
        const gridControl = document.getElementById('grid-control');
        const gridSizeDisplay = document.getElementById('grid-size-display');
        // Update board dimension display
        const updateSizeDisplay = () => {
            gridSizeDisplay.textContent = `${this.boardWidth}×${this.boardHeight}`;
        };
        // Bind directional buttons on grid control
        const dirButtons = gridControl.querySelectorAll('.grid-btn');
        dirButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = btn.dataset.dir;
                if (!dir)
                    return;
                switch (dir) {
                    case 'increase-width':
                        this.updateBoardDimensions(this.boardWidth + 1, this.boardHeight);
                        break;
                    case 'decrease-width':
                        this.updateBoardDimensions(this.boardWidth - 1, this.boardHeight);
                        break;
                    case 'increase-height':
                        this.updateBoardDimensions(this.boardWidth, this.boardHeight + 1);
                        break;
                    case 'decrease-height':
                        this.updateBoardDimensions(this.boardWidth, this.boardHeight - 1);
                        break;
                }
                updateSizeDisplay();
            });
        });
        updateSizeDisplay();
        // Handle active layer button click to toggle menu
        this.activeLayerButton.addEventListener('click', () => {
            this.layerMenu.classList.toggle('hidden');
        });
        // Handle layer item clicks
        const layerItems = this.layerMenu.querySelectorAll('.layer-item');
        layerItems.forEach((item) => {
            item.addEventListener('click', () => {
                const layer = item.dataset.layer;
                if (!layer)
                    return;
                this.setCurrentLayer(layer);
                // Update active button image to selected layer
                const img = item.querySelector('img');
                const activeImg = this.activeLayerButton.querySelector('img');
                if (img && activeImg) {
                    activeImg.src = img.src;
                    activeImg.alt = img.alt;
                }
                // Collapse the menu
                this.layerMenu.classList.add('hidden');
            });
        });
        // Bind height button to spawn a new height object
        this.heightButton.addEventListener('click', () => {
            this.createHeightObject();
        });
        // Bind apply, cancel and delete buttons in height popup
        this.heightApplyButton.addEventListener('click', () => {
            this.applyHeightSettings();
        });
        this.heightCancelButton.addEventListener('click', () => {
            this.cancelHeightSettings();
        });
        if (this.heightDeleteButton) {
            this.heightDeleteButton.addEventListener('click', () => {
                this.deleteHeightObject();
            });
        }
        // Initialise current layer (default 'hex')
        this.setCurrentLayer(this.currentLayer);
    }
    /**
     * Update the current paint layer.  Shows or hides the grid controller
     * depending on whether the hex layer is active.  Future implementations
     * could toggle visibility of Terra, liquid or prop layers.
     */
    setCurrentLayer(layer) {
        this.currentLayer = layer;
        // Show grid control only for the hex layer
        const gridControl = document.getElementById('grid-control');
        if (layer === 'hex') {
            gridControl.classList.remove('hidden');
        }
        else {
            gridControl.classList.add('hidden');
        }
        // Could also adjust visibility of layers here (e.g., show/hide Terra mesh)
    }
    /**
     * Spawn a new height object at the current camera focus with default
     * radius and height.  Opens the settings popup allowing the user to
     * adjust radius and height.  If the popup is cancelled the object is
     * removed.
     */
    createHeightObject() {
        // Use default values from the input fields
        const defaultRadius = parseFloat(this.heightRadiusInput.value) || 1;
        const defaultHeight = parseFloat(this.heightValueInput.value) || 1;
        // Create a thin cylinder to represent the influence area
        const obj = new pc.Entity('HeightObject');
        obj.addComponent('model', { type: 'cylinder' });
        // Scale horizontally by radius (diameter) and vertically by a small constant
        obj.setLocalScale(defaultRadius * 2, 0.05, defaultRadius * 2);
        obj.setLocalPosition(this.cameraFocus.x, 0.03, this.cameraFocus.z);
        // Assign a coloured material based on height sign
        const mat = new pc.StandardMaterial();
        if (defaultHeight >= 0) {
            mat.diffuse.set(0.3, 0.55, 0.85); // blue-ish for raised
        }
        else {
            mat.diffuse.set(0.9, 0.55, 0.25); // orange-ish for lowered
        }
        mat.emissive.set(mat.diffuse.r, mat.diffuse.g, mat.diffuse.b);
        mat.update();
        obj.model.material = mat;
        // Add to scene and record
        this.app.root.addChild(obj);
        const index = this.heightObjects.length;
        this.heightObjects.push({ entity: obj, radius: defaultRadius, height: defaultHeight });
        this.pendingHeightIndex = index;
        this.isCreatingNewHeight = true;
        // Prefill the popup values
        this.heightRadiusInput.value = defaultRadius.toString();
        this.heightValueInput.value = defaultHeight.toString();
        // Show the popup
        this.heightPopup.classList.remove('hidden');
    }
    /**
     * Apply the edited settings to the pending height object.  Updates its
     * scale and colour based on the selected radius and height.  Hides the
     * popup afterwards.
     */
    applyHeightSettings() {
        if (this.pendingHeightIndex === null) {
            return;
        }
        const radius = parseFloat(this.heightRadiusInput.value) || 1;
        const heightVal = parseFloat(this.heightValueInput.value) || 1;
        const objData = this.heightObjects[this.pendingHeightIndex];
        objData.radius = radius;
        objData.height = heightVal;
        // Update scale (diameter on X/Z) and keep thin height
        objData.entity.setLocalScale(radius * 2, 0.05, radius * 2);
        // Update colour based on sign
        const mat = new pc.StandardMaterial();
        if (heightVal >= 0) {
            mat.diffuse.set(0.3, 0.55, 0.85);
        }
        else {
            mat.diffuse.set(0.9, 0.55, 0.25);
        }
        mat.emissive.set(mat.diffuse.r, mat.diffuse.g, mat.diffuse.b);
        mat.update();
        objData.entity.model.material = mat;
        // Close popup
        this.heightPopup.classList.add('hidden');
        this.pendingHeightIndex = null;
        // After applying changes, we are no longer in create mode
        this.isCreatingNewHeight = false;
    }
    /**
     * Open the height settings popup for an existing height object.  The
     * current radius and height values are prefilled in the input fields.
     * The delete button is shown to allow removal of the object.  Dragging
     * will still be enabled while the popup is open so the object can be
     * repositioned.
     *
     * @param index Index into the heightObjects array for the object being edited.
     */
    openHeightPopup(index) {
        // Guard against invalid index
        if (index < 0 || index >= this.heightObjects.length) {
            return;
        }
        this.pendingHeightIndex = index;
        // Editing an existing height object
        this.isCreatingNewHeight = false;
        const objData = this.heightObjects[index];
        // Prefill radius and height fields with the object's current values
        this.heightRadiusInput.value = objData.radius.toString();
        this.heightValueInput.value = objData.height.toString();
        // Show the popup
        this.heightPopup.classList.remove('hidden');
        // If a delete button exists, make it visible when editing
        if (this.heightDeleteButton) {
            this.heightDeleteButton.style.display = 'inline-block';
        }
    }
    /**
     * Delete the currently selected height object.  Removes it from the
     * scene and from the heightObjects array.  Closes the popup after
     * deletion.
     */
    deleteHeightObject() {
        if (this.pendingHeightIndex === null) {
            return;
        }
        const index = this.pendingHeightIndex;
        if (index < 0 || index >= this.heightObjects.length) {
            this.pendingHeightIndex = null;
            this.heightPopup.classList.add('hidden');
            return;
        }
        const objData = this.heightObjects[index];
        // Destroy the entity and remove from array
        objData.entity.destroy();
        this.heightObjects.splice(index, 1);
        // Reset pending index and hide popup
        this.pendingHeightIndex = null;
        this.isCreatingNewHeight = false;
        this.heightPopup.classList.add('hidden');
    }
    /**
     * Cancel editing the pending height object.  Removes it from the scene
     * and from the heightObjects list.  Hides the popup.
     */
    cancelHeightSettings() {
        if (this.pendingHeightIndex === null) {
            // Nothing to cancel
            return;
        }
        // If we are cancelling a newly created height object, remove it completely
        if (this.isCreatingNewHeight) {
            const objData = this.heightObjects[this.pendingHeightIndex];
            objData.entity.destroy();
            this.heightObjects.splice(this.pendingHeightIndex, 1);
        }
        // Reset state and hide popup
        this.pendingHeightIndex = null;
        this.isCreatingNewHeight = false;
        this.heightPopup.classList.add('hidden');
    }
    /**
     * Update the compass orientation based on the camera’s yaw.  Rotates
     * the compass container so that the W arrow points “north” relative
     * to the current camera heading.  This method should be called on
     * every frame.
     */
    updateCompass() {
        if (!this.compassElement)
            return;
        // Get Euler angles of the camera; .y is yaw in degrees
        const euler = this.camera.getEulerAngles();
        const yaw = euler.y;
        // Rotate the compass by the yaw so the arrows align with world axes
        this.compassElement.style.transform = `rotate(${yaw}deg)`;
    }
    buildGridTexture(width, height) {
        // Build a grid texture sized to the given number of columns (width) and
        // rows (height).  The texture is always square to avoid uneven
        // stretching when applied to the board plane.  Grid lines are
        // computed relative to the number of divisions along each axis.
        const gridCanvas = document.createElement('canvas');
        gridCanvas.width = 1024;
        gridCanvas.height = 1024;
        const context = gridCanvas.getContext('2d');
        if (!context) {
            throw new Error('Could not create a grid texture context.');
        }
        // Background fill
        context.fillStyle = '#1b2230';
        context.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
        // Draw the grid lines.  Use separate steps for the X and Y axes so the
        // spacing remains correct even when the board is rectangular.
        const stepX = gridCanvas.width / width;
        const stepY = gridCanvas.height / height;
        context.strokeStyle = '#51607a';
        context.lineWidth = 2;
        for (let i = 0; i <= width; i += 1) {
            const offset = Math.round(i * stepX) + 0.5;
            context.beginPath();
            context.moveTo(offset, 0);
            context.lineTo(offset, gridCanvas.height);
            context.stroke();
        }
        for (let j = 0; j <= height; j += 1) {
            const offset = Math.round(j * stepY) + 0.5;
            context.beginPath();
            context.moveTo(0, offset);
            context.lineTo(gridCanvas.width, offset);
            context.stroke();
        }
        // Outer border
        context.strokeStyle = '#8db1ff';
        context.lineWidth = 4;
        context.strokeRect(2, 2, gridCanvas.width - 4, gridCanvas.height - 4);
        // Light shading across the centre to help orient the board.  Use
        // fractions of the texture size so the shading remains centred even
        // when width and height differ.
        context.fillStyle = 'rgba(137, 180, 255, 0.08)';
        context.fillRect(gridCanvas.width / 4, 0, gridCanvas.width / 2, gridCanvas.height);
        context.fillRect(0, gridCanvas.height / 4, gridCanvas.width, gridCanvas.height / 2);
        const texture = new pc.Texture(this.app.graphicsDevice, {
            width: gridCanvas.width,
            height: gridCanvas.height,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true
        });
        texture.setSource(gridCanvas);
        return texture;
    }
    buildMarkerTexture() {
        const markerCanvas = document.createElement('canvas');
        markerCanvas.width = 512;
        markerCanvas.height = 512;
        const context = markerCanvas.getContext('2d');
        if (!context) {
            throw new Error('Could not create a selection marker texture context.');
        }
        context.clearRect(0, 0, markerCanvas.width, markerCanvas.height);
        context.translate(markerCanvas.width / 2, markerCanvas.height / 2);
        context.strokeStyle = '#89b4ff';
        context.lineWidth = 24;
        context.beginPath();
        context.arc(0, 0, 170, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        context.lineWidth = 6;
        context.beginPath();
        context.arc(0, 0, 110, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = 'rgba(137, 180, 255, 0.18)';
        context.beginPath();
        context.arc(0, 0, 145, 0, Math.PI * 2);
        context.fill();
        const texture = new pc.Texture(this.app.graphicsDevice, {
            width: markerCanvas.width,
            height: markerCanvas.height,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true
        });
        texture.setSource(markerCanvas);
        return texture;
    }
    buildTokenTexture(label) {
        const tokenCanvas = document.createElement('canvas');
        tokenCanvas.width = 512;
        tokenCanvas.height = 512;
        const context = tokenCanvas.getContext('2d');
        if (!context) {
            throw new Error('Could not create a token texture context.');
        }
        context.clearRect(0, 0, tokenCanvas.width, tokenCanvas.height);
        context.translate(tokenCanvas.width / 2, tokenCanvas.height / 2);
        const outerGradient = context.createRadialGradient(0, -24, 32, 0, 0, 220);
        outerGradient.addColorStop(0, '#edf3ff');
        outerGradient.addColorStop(0.55, '#89b4ff');
        outerGradient.addColorStop(1, '#20324f');
        context.fillStyle = outerGradient;
        context.beginPath();
        context.arc(0, 0, 190, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#ffffff';
        context.lineWidth = 16;
        context.beginPath();
        context.arc(0, 0, 188, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = '#07111d';
        context.beginPath();
        context.arc(0, 0, 148, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#eef4ff';
        context.font = 'bold 140px Inter, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, 0, 8);
        context.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        context.lineWidth = 8;
        context.beginPath();
        context.arc(0, 0, 96, Math.PI * 0.15, Math.PI * 0.85);
        context.stroke();
        const texture = new pc.Texture(this.app.graphicsDevice, {
            width: tokenCanvas.width,
            height: tokenCanvas.height,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true
        });
        texture.setSource(tokenCanvas);
        return texture;
    }
    /**
     * Resize the game board to the specified number of columns (width) and
     * rows (height).  This method updates the underlying plane scale,
     * re‑generates the grid texture, resizes the rim and clamps any
     * positional values (camera, token and marker) to lie within the new
     * extents.  Finally the camera is refreshed and the stats display
     * updated.
     */
    updateBoardDimensions(width, height) {
        // Guard against invalid sizes
        width = Math.max(1, Math.floor(width));
        height = Math.max(1, Math.floor(height));
        this.boardWidth = width;
        this.boardHeight = height;
        // Update board scaling and texture
        if (this.board) {
            this.board.setLocalScale(width, 1, height);
            // Reapply the rotation on the X axis.  Changing scale on some
            // primitive types can internally reset transformation matrices,
            // causing the plane to revert to its default orientation.  By
            // explicitly setting the euler angles again we ensure the board
            // remains flat on the X/Z plane.
            this.board.setLocalEulerAngles(-90, 0, 0);
            const newGrid = this.buildGridTexture(width, height);
            const material = this.board.model.material;
            material.diffuseMap = newGrid;
            material.emissiveMap = newGrid;
            material.update();
        }
        // Update rim scale
        if (this.boardRim) {
            // The rim is a box oriented in the X/Z plane by default.  Adjust
            // its scale to hug the board edges without altering its
            // orientation.  Since a box is symmetrical along its axes, no
            // rotation is necessary.
            this.boardRim.setLocalScale(width + 0.35, 0.16, height + 0.35);
        }
        // Clamp camera focus
        const limitX = width / 2;
        const limitZ = height / 2;
        this.cameraFocus.x = pc.math.clamp(this.cameraFocus.x, -limitX, limitX);
        this.cameraFocus.z = pc.math.clamp(this.cameraFocus.z, -limitZ, limitZ);
        // Clamp token and target positions
        this.tokenPosition.x = pc.math.clamp(this.tokenPosition.x, -limitX, limitX);
        this.tokenPosition.z = pc.math.clamp(this.tokenPosition.z, -limitZ, limitZ);
        this.targetPosition.x = pc.math.clamp(this.targetPosition.x, -limitX, limitX);
        this.targetPosition.z = pc.math.clamp(this.targetPosition.z, -limitZ, limitZ);
        if (this.selectionMarker) {
            this.selectionMarker.setPosition(this.targetPosition.x, 0.02, this.targetPosition.z);
        }
        // Refresh camera to honour new focus
        this.refreshCamera();
        // Update the position of the token entity
        if (this.token) {
            this.token.setPosition(this.tokenPosition);
        }
        // Update UI stats display
        this.updateStats();
    }
}
const canvas = document.querySelector('#application');
new SMBVttStarter(canvas);
