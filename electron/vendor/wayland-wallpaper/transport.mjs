import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const PREBUILT_PACKAGES = {
    darwin: {
        arm64: "@covas-labs/electron-overlay-prebuilt-darwin-arm64"
    },
    linux: {
        x64: "@covas-labs/electron-overlay-prebuilt-linux-x64"
    },
    win32: {
        x64: "@covas-labs/electron-overlay-prebuilt-win32-x64"
    }
};
let addon = null;
let layerShellAddon = null;
const CAPABILITIES = {
    win32: {
        backend: "win32",
        clickThrough: true,
        aboveFullscreen: true,
        externalParent: true,
        parentDiscovery: true,
        globalPositioning: true,
        boundsCoordinateSpace: "native-pixels"
    },
    macos: {
        backend: "macos",
        clickThrough: true,
        aboveFullscreen: true,
        externalParent: false,
        parentDiscovery: true,
        globalPositioning: true,
        boundsCoordinateSpace: "electron-screen"
    },
    x11: {
        backend: "x11",
        clickThrough: true,
        aboveFullscreen: true,
        externalParent: true,
        parentDiscovery: true,
        globalPositioning: true,
        boundsCoordinateSpace: "native-pixels"
    },
    "wayland-electron": {
        backend: "wayland-electron",
        clickThrough: true,
        aboveFullscreen: false,
        externalParent: false,
        parentDiscovery: false,
        globalPositioning: false,
        boundsCoordinateSpace: "electron-screen"
    }
};
const LAYER_SHELL_CAPABILITIES = {
    backend: "wayland-layer-shell",
    clickThrough: true,
    aboveFullscreen: false,
    externalParent: false,
    parentDiscovery: false,
    globalPositioning: false,
    outputPlacement: true,
    parentPlacement: false,
    keyboardInteractivity: "none",
    renderingMode: "electron-offscreen",
    preferredBufferTransport: "linux-dmabuf",
    bufferTransports: ["linux-dmabuf", "wl_shm"],
    shmFallback: true
};
function nativeBackendKind() {
    if (process.platform === "win32")
        return "win32";
    if (process.platform === "darwin")
        return "macos";
    return "x11";
}
function detectLinuxBackend() {
    const ozoneArgument = process.argv.find((argument) => argument.startsWith("--ozone-platform="));
    const ozonePlatform = ozoneArgument?.slice("--ozone-platform=".length);
    if (ozonePlatform === "x11" || ozonePlatform === "wayland") {
        return {
            backend: ozonePlatform === "wayland" ? "wayland-electron" : "x11",
            source: "ozone-argument",
            confidence: "certain",
            evidence: ozoneArgument
        };
    }
    const ozoneEnvironment = process.env.OZONE_PLATFORM ?? process.env.ELECTRON_OZONE_PLATFORM_HINT;
    if (ozoneEnvironment === "x11" || ozoneEnvironment === "wayland") {
        return {
            backend: ozoneEnvironment === "wayland" ? "wayland-electron" : "x11",
            source: "environment",
            confidence: "inferred",
            evidence: `Ozone environment hint is ${ozoneEnvironment}`
        };
    }
    if (process.env.XDG_SESSION_TYPE === "wayland" && process.env.WAYLAND_DISPLAY) {
        return {
            backend: "wayland-electron",
            source: "environment",
            confidence: "inferred",
            evidence: "XDG_SESSION_TYPE=wayland and WAYLAND_DISPLAY is set"
        };
    }
    return {
        backend: "x11",
        source: "platform-default",
        confidence: "inferred",
        evidence: "No explicit native-Wayland evidence was available"
    };
}
export function getBackendSelection(target, preference = "auto") {
    if (preference !== "auto") {
        return {
            backend: preference,
            source: "explicit",
            confidence: "certain",
            evidence: `backend=${preference}`
        };
    }
    if (Buffer.isBuffer(target) || process.platform !== "linux") {
        const backend = nativeBackendKind();
        return {
            backend,
            source: Buffer.isBuffer(target) ? "native-handle" : "platform-default",
            confidence: "certain",
            evidence: Buffer.isBuffer(target)
                ? "Buffer targets retain the platform native backend"
                : `process.platform=${process.platform}`
        };
    }
    return detectLinuxBackend();
}
function resolveBackend(preference, target) {
    return getBackendSelection(target, preference).backend;
}
export function getCapabilities(target, backend = "auto") {
    return { ...CAPABILITIES[resolveBackend(backend, target)] };
}
export function getLayerShellCapabilities() {
    return { ...LAYER_SHELL_CAPABILITIES };
}
function loadLayerShellAddon() {
    if (process.platform !== "linux") throw new Error("Wayland wallpaper is only supported on Linux.");
    if (!layerShellAddon) {
        const require = createRequire(import.meta.url);
        try { layerShellAddon = require("./build/Release/wayland_layer_shell.node"); }
        catch (error) { throw new Error("Wayland wallpaper helper is unavailable. Run npm run build:wayland. " + error.message); }
    }
    return layerShellAddon;
}

function loadAddon() {
    if (addon) {
        return addon;
    }
    const require = createRequire(import.meta.url);
    const applicationRequire = createRequire(resolve(process.cwd(), "package.json"));
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageDir = resolve(currentDir, "..");
    const workspacePackagesDir = resolve(packageDir, "..");
    const nativeWorkspaceDir = resolve(workspacePackagesDir, "native-addon");
    const localPath = resolve(nativeWorkspaceDir, "build", "Release", "x11_overlay.node");
    const prebuiltPackage = PREBUILT_PACKAGES[process.platform]?.[process.arch];
    const errors = [];
    if (prebuiltPackage) {
        try {
            addon = require(prebuiltPackage);
        }
        catch (packageError) {
            errors.push(`package: ${String(packageError)}`);
            try {
                addon = applicationRequire(prebuiltPackage);
            }
            catch (applicationError) {
                errors.push(`application: ${String(applicationError)}`);
            }
        }
    }
    const isWorkspaceDevelopment = basename(packageDir) === "electron-overlay"
        && basename(workspacePackagesDir) === "packages"
        && existsSync(resolve(nativeWorkspaceDir, "package.json"));
    if (!addon && isWorkspaceDevelopment) {
        try {
            addon = require(localPath);
        }
        catch (localError) {
            errors.push(`workspace: ${String(localError)}`);
        }
    }
    if (!addon) {
        if (!prebuiltPackage) {
            throw new Error(`No native overlay prebuilt is available for ${process.platform}-${process.arch}.`);
        }
        throw new Error(`Failed to load the native overlay addon for ${process.platform}-${process.arch}. ${errors.join("; ")}`);
    }
    return addon;
}
function validateRect(rect) {
    for (const key of ["x", "y", "width", "height"]) {
        if (!Number.isFinite(rect[key])) {
            throw new TypeError(`bounds.${key} must be a finite number.`);
        }
    }
    if (rect.width <= 0 || rect.height <= 0) {
        throw new RangeError("bounds width and height must be positive.");
    }
    return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };
}
function isNativeImageLike(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return typeof candidate.isEmpty === "function"
        && typeof candidate.getSize === "function"
        && typeof candidate.toBitmap === "function";
}
function isSharedTexturePayload(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return typeof candidate.release === "function"
        && !!candidate.textureInfo
        && typeof candidate.textureInfo === "object";
}
function snapshotLinuxTextureInfo(texture) {
    const textureInfo = texture.textureInfo;
    const nativePixmap = textureInfo.handle?.nativePixmap;
    const codedSize = textureInfo.codedSize;
    const pixelFormat = textureInfo.pixelFormat;
    const modifier = nativePixmap?.modifier ?? textureInfo.modifier;
    const planes = nativePixmap?.planes ?? textureInfo.planes;
    if (!codedSize || (pixelFormat !== "rgba" && pixelFormat !== "bgra")
        || typeof modifier !== "string" || !planes?.length) {
        return null;
    }
    return {
        codedSize: { width: codedSize.width, height: codedSize.height },
        pixelFormat,
        modifier,
        planes: planes.map(({ fd, stride, offset, size }) => ({ fd, stride, offset, size }))
    };
}
export function displayToNativeRect(display) {
    if (process.platform === "darwin") {
        return validateRect(display.bounds);
    }
    const origin = display.nativeOrigin ?? {
        x: Math.round(display.bounds.x * display.scaleFactor),
        y: Math.round(display.bounds.y * display.scaleFactor)
    };
    return validateRect({
        x: origin.x,
        y: origin.y,
        width: display.bounds.width * display.scaleFactor,
        height: display.bounds.height * display.scaleFactor
    });
}
export function displayToOverlayRect(display, target, backend = "auto") {
    return getCapabilities(target, backend).boundsCoordinateSpace === "electron-screen"
        ? validateRect(display.bounds)
        : displayToNativeRect(display);
}
export class OverlayController {
    controller;
    capabilities;
    constructor(controller, capabilities = CAPABILITIES[nativeBackendKind()]) {
        this.controller = controller;
        this.capabilities = capabilities;
    }
    attachParent(query, options = {}) {
        return this.controller.attachParent(query, options);
    }
    detachParent() { this.controller.detachParent(); }
    setBounds(bounds) { this.controller.setBounds(validateRect(bounds)); }
    useParentBounds() { return this.controller.useParentBounds(); }
    setClickThrough(enabled) { this.controller.setClickThrough(enabled); }
    setAlwaysOnTop(enabled) { this.controller.setAlwaysOnTop(enabled); }
    reapply() { this.controller.reapply(); }
    getState() { return this.controller.getState(); }
    getCapabilities() { return { ...this.capabilities }; }
    close() { this.controller.close(); }
}
export class LayerShellOverlayController {
    controller;
    detachSource;
    sourceAttached = false;
    renderError;
    closed = false;
    sourceGeneration = 0;
    nextSubmissionId = 1;
    dmabufLeases = new Map();
    leaseMonitor;
    constructor(controller) {
        this.controller = controller;
    }
    releaseTexture(texture) {
        try {
            texture.release();
        }
        catch (error) {
            this.renderError ??= String(error);
        }
    }
    allocateSubmissionId() {
        const start = this.nextSubmissionId;
        do {
            const submissionId = this.nextSubmissionId;
            this.nextSubmissionId = submissionId === Number.MAX_SAFE_INTEGER ? 1 : submissionId + 1;
            if (!this.dmabufLeases.has(submissionId))
                return submissionId;
        } while (this.nextSubmissionId !== start);
        throw new Error("No DMA-BUF submission IDs are available.");
    }
    stopLeaseMonitor() {
        if (this.leaseMonitor)
            clearInterval(this.leaseMonitor);
        this.leaseMonitor = undefined;
    }
    drainReleasedDmabufs() {
        let releasedIds;
        try {
            releasedIds = this.controller.takeReleasedDmabufs();
        }
        catch (error) {
            this.renderError ??= String(error);
            return;
        }
        for (const submissionId of releasedIds) {
            const texture = this.dmabufLeases.get(submissionId);
            if (!texture)
                continue;
            this.dmabufLeases.delete(submissionId);
            this.releaseTexture(texture);
        }
        if (this.dmabufLeases.size === 0)
            this.stopLeaseMonitor();
    }
    retainDmabuf(submissionId, texture) {
        this.dmabufLeases.set(submissionId, texture);
        if (this.leaseMonitor)
            return;
        this.leaseMonitor = setInterval(() => this.drainReleasedDmabufs(), 25);
        this.leaseMonitor.unref?.();
    }
    attachOffscreenWindow(window) {
        if (this.closed)
            throw new Error("Layer-shell overlay controller is closed.");
        if (!window || typeof window !== "object" || !window.webContents) {
            throw new TypeError("attachOffscreenWindow requires an Electron offscreen BrowserWindow.");
        }
        const webContents = window.webContents;
        const requiredWindowMethods = ["getContentSize", "setContentSize"];
        const requiredWebContentsMethods = [
            "isOffscreen",
            "isDestroyed",
            "invalidate",
            "capturePage",
            "on",
            "removeListener"
        ];
        if (requiredWindowMethods.some((method) => typeof window[method] !== "function")
            || requiredWebContentsMethods.some((method) => typeof webContents[method] !== "function")) {
            throw new TypeError("attachOffscreenWindow requires Electron offscreen BrowserWindow methods, including webContents.capturePage().");
        }
        if (window.isDestroyed?.() || webContents.isDestroyed()) {
            throw new Error("Electron offscreen BrowserWindow is destroyed.");
        }
        if (!webContents.isOffscreen()) {
            throw new Error("BrowserWindow must be created with webPreferences.offscreen enabled.");
        }
        this.detachSource?.();
        const attachmentGeneration = ++this.sourceGeneration;
        let sizeMonitor;
        let captureTimer;
        let invalidatePending = false;
        let invalidating = false;
        let sourceActive = true;
        let captureInFlight = false;
        let pendingCaptureGeneration;
        let latestPaintGeneration = 0;
        let lastSubmittedGeneration = 0;
        let lastCaptureStartedAt = 0;
        let dmabufFallbackActive = false;
        const nextPaintGeneration = () => {
            latestPaintGeneration += 1;
            return latestPaintGeneration;
        };
        const terminalError = (state) => {
            if (state.error)
                return state.error;
            if (state.compositorClosed)
                return "The Wayland compositor closed the layer-shell surface.";
            if (state.closed)
                return "The layer-shell overlay controller is closed.";
            return undefined;
        };
        const resizeSource = (forceInvalidate = false, allowInvalidate = true) => {
            const state = this.controller.getState();
            const error = terminalError(state);
            if (error)
                throw new Error(error);
            const [sourceWidth, sourceHeight] = window.getContentSize();
            if (state.width !== sourceWidth || state.height !== sourceHeight) {
                window.setContentSize(state.width, state.height);
                invalidatePending = true;
            }
            if (forceInvalidate)
                invalidatePending = true;
            if (allowInvalidate && invalidatePending && !invalidating) {
                invalidatePending = false;
                invalidating = true;
                try {
                    webContents.invalidate();
                }
                finally {
                    invalidating = false;
                }
            }
        };
        const submitImage = (image, generation) => {
            if (this.closed || !sourceActive)
                return "terminal";
            if (image.isEmpty())
                return "retry";
            try {
                const state = this.controller.getState();
                const error = terminalError(state);
                if (error) {
                    this.renderError = error;
                    this.close();
                    return "terminal";
                }
                const size = image.getSize(1);
                if (size.width !== state.width || size.height !== state.height) {
                    resizeSource(true, false);
                    return "resize";
                }
                const bitmap = image.toBitmap({ scaleFactor: 1 });
                if (bitmap.length !== size.width * size.height * 4) {
                    this.renderError = "Electron offscreen bitmap length does not match its dimensions.";
                    return "retry";
                }
                if (!this.controller.submitFrame(bitmap, size.width, size.height)) {
                    const rejectedState = this.controller.getState();
                    const rejectedError = terminalError(rejectedState);
                    if (rejectedError) {
                        this.renderError = rejectedError;
                        this.close();
                        return "terminal";
                    }
                    return "retry";
                }
                this.renderError = undefined;
                lastSubmittedGeneration = Math.max(lastSubmittedGeneration, generation);
                return "submitted";
            }
            catch (error) {
                this.renderError = String(error);
                return this.closed ? "terminal" : "retry";
            }
        };
        const startCaptureFallback = () => {
            captureTimer = undefined;
            if (!sourceActive || this.closed || captureInFlight
                || pendingCaptureGeneration === undefined)
                return;
            const captureGeneration = pendingCaptureGeneration;
            pendingCaptureGeneration = undefined;
            let state;
            try {
                state = this.controller.getState();
                const error = terminalError(state);
                if (error) {
                    this.renderError = error;
                    this.close();
                    return;
                }
            }
            catch (error) {
                this.renderError = String(error);
                return;
            }
            captureInFlight = true;
            lastCaptureStartedAt = Date.now();
            let capture;
            try {
                capture = webContents.capturePage({ x: 0, y: 0, width: state.width, height: state.height });
            }
            catch {
                captureInFlight = false;
                pendingCaptureGeneration = captureGeneration;
                scheduleCaptureFallback(captureGeneration);
                return;
            }
            void capture
                .then((image) => {
                if (!sourceActive || this.closed || attachmentGeneration !== this.sourceGeneration
                    || captureGeneration < lastSubmittedGeneration)
                    return;
                if (submitImage(image, captureGeneration) === "retry") {
                    pendingCaptureGeneration = Math.max(captureGeneration, latestPaintGeneration);
                }
            })
                .catch(() => {
                if (!sourceActive || this.closed)
                    return;
                pendingCaptureGeneration = Math.max(captureGeneration, latestPaintGeneration);
                try {
                    const terminal = terminalError(this.controller.getState());
                    if (!terminal)
                        return;
                    this.renderError = terminal;
                    this.close();
                }
                catch (stateError) {
                    this.renderError = String(stateError);
                    this.close();
                }
            })
                .finally(() => {
                captureInFlight = false;
                if (sourceActive && !this.closed && pendingCaptureGeneration !== undefined) {
                    scheduleCaptureFallback(pendingCaptureGeneration);
                }
            });
        };
        const scheduleCaptureFallback = (generation) => {
            if (!sourceActive || this.closed)
                return;
            pendingCaptureGeneration = generation;
            if (captureInFlight || captureTimer)
                return;
            const delay = Math.max(0, 100 - (Date.now() - lastCaptureStartedAt));
            if (delay === 0) {
                startCaptureFallback();
                return;
            }
            captureTimer = setTimeout(startCaptureFallback, delay);
            captureTimer.unref?.();
        };
        const useSoftwareFallback = (image, generation) => {
            dmabufFallbackActive = true;
            if (!image || submitImage(image, generation) === "retry")
                scheduleCaptureFallback(generation);
        };
        const paint = (event, _dirtyRect, result) => {
            const texture = isSharedTexturePayload(event?.texture)
                ? event.texture
                : isSharedTexturePayload(result)
                    ? result
                    : null;
            const image = isNativeImageLike(result) ? result : undefined;
            let releaseTexture = texture !== null;
            try {
                if (this.closed || !sourceActive || attachmentGeneration !== this.sourceGeneration)
                    return;
                const paintGeneration = nextPaintGeneration();
                this.drainReleasedDmabufs();
                if (!texture) {
                    if (!image || submitImage(image, paintGeneration) === "retry") {
                        scheduleCaptureFallback(paintGeneration);
                    }
                    return;
                }
                const info = snapshotLinuxTextureInfo(texture);
                const state = this.controller.getState();
                const error = terminalError(state);
                if (error) {
                    this.renderError = error;
                    this.close();
                    return;
                }
                if (!info || state.dmabufUsable === false) {
                    useSoftwareFallback(image, paintGeneration);
                    return;
                }
                if (info.codedSize.width !== state.width || info.codedSize.height !== state.height) {
                    resizeSource(true, false);
                    useSoftwareFallback(image, paintGeneration);
                    return;
                }
                const submissionId = this.allocateSubmissionId();
                let submitted = false;
                try {
                    submitted = this.controller.submitDmabuf(info, submissionId);
                }
                catch (submitError) {
                    this.renderError = String(submitError);
                }
                if (!submitted) {
                    const rejectedState = this.controller.getState();
                    const rejectedError = terminalError(rejectedState);
                    if (rejectedError) {
                        this.renderError = rejectedError;
                        this.close();
                        return;
                    }
                    useSoftwareFallback(image, paintGeneration);
                    return;
                }
                this.retainDmabuf(submissionId, texture);
                releaseTexture = false;
                lastSubmittedGeneration = Math.max(lastSubmittedGeneration, paintGeneration);
                this.drainReleasedDmabufs();
                const submittedState = this.controller.getState();
                const submittedError = terminalError(submittedState);
                if (submittedError) {
                    this.renderError = submittedError;
                    this.close();
                    return;
                }
                if (submittedState.dmabufUsable === false) {
                    useSoftwareFallback(image, paintGeneration);
                    return;
                }
                dmabufFallbackActive = false;
                this.renderError = undefined;
            }
            catch (error) {
                this.renderError = String(error);
                if (!this.closed && sourceActive) {
                    useSoftwareFallback(image, latestPaintGeneration || nextPaintGeneration());
                }
            }
            finally {
                if (texture && releaseTexture)
                    this.releaseTexture(texture);
            }
        };
        const destroyed = () => {
            if (sourceActive && attachmentGeneration === this.sourceGeneration)
                this.close();
        };
        const monitorSize = () => {
            if (this.closed || !sourceActive || attachmentGeneration !== this.sourceGeneration)
                return;
            try {
                this.drainReleasedDmabufs();
                resizeSource();
                const state = this.controller.getState();
                if (state.dmabufUsable === false && !dmabufFallbackActive) {
                    dmabufFallbackActive = true;
                    scheduleCaptureFallback(nextPaintGeneration());
                }
            }
            catch (error) {
                this.renderError = String(error);
                this.close();
            }
        };
        webContents.on("paint", paint);
        webContents.on("destroyed", destroyed);
        const detachNewSource = () => {
            sourceActive = false;
            pendingCaptureGeneration = undefined;
            if (captureTimer)
                clearTimeout(captureTimer);
            captureTimer = undefined;
            if (sizeMonitor)
                clearInterval(sizeMonitor);
            webContents.removeListener("paint", paint);
            webContents.removeListener("destroyed", destroyed);
            if (this.detachSource === detachNewSource) {
                this.detachSource = undefined;
                this.sourceAttached = false;
            }
        };
        this.detachSource = detachNewSource;
        this.sourceAttached = true;
        try {
            resizeSource(true);
            if (this.closed) {
                throw new Error(this.renderError ?? "Layer-shell overlay controller closed while attaching its source.");
            }
            sizeMonitor = setInterval(monitorSize, 100);
            sizeMonitor.unref?.();
        }
        catch (error) {
            detachNewSource();
            throw error;
        }
    }
    getState() {
        this.drainReleasedDmabufs();
        return {
            ...this.controller.getState(),
            sourceAttached: this.sourceAttached,
            ...(this.renderError && { renderError: this.renderError })
        };
    }
    getCapabilities() { return getLayerShellCapabilities(); }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.sourceGeneration += 1;
        this.detachSource?.();
        let closeError;
        try {
            this.controller.close();
        }
        catch (error) {
            closeError = error;
        }
        this.drainReleasedDmabufs();
        this.stopLeaseMonitor();
        for (const [submissionId, texture] of this.dmabufLeases) {
            this.dmabufLeases.delete(submissionId);
            this.releaseTexture(texture);
        }
        if (closeError)
            throw closeError;
    }
}
export async function createLayerShellOverlay(options) {
    if (!options || !options.placement) {
        throw new TypeError("placement is required for the layer-shell backend.");
    }
    const placement = options.placement;
    if (placement.type !== "output" || placement.anchor !== "fill") {
        throw new RangeError("The experimental layer-shell backend currently supports only fill-output placement.");
    }
    if (typeof placement.output !== "string" || !placement.output.trim()) {
        throw new TypeError("placement.output must be a non-empty Wayland output name.");
    }
    if (options.namespace !== undefined && (typeof options.namespace !== "string" || !options.namespace.trim())) {
        throw new TypeError("namespace must be a non-empty string.");
    }
    if (options.initializationTimeoutMs !== undefined
        && (!Number.isFinite(options.initializationTimeoutMs)
            || options.initializationTimeoutMs < 100
            || options.initializationTimeoutMs > 60_000)) {
        throw new RangeError("initializationTimeoutMs must be between 100 and 60000.");
    }
    const controller = loadLayerShellAddon().createLayerShellOverlay({
        output: placement.output,
        ...(options.namespace && { namespace: options.namespace }),
        ...(options.initializationTimeoutMs !== undefined && {
            initializationTimeoutMs: Math.round(options.initializationTimeoutMs)
        })
    });
    await controller.initialize();
    return new LayerShellOverlayController(controller);
}
export { OverlayController as X11Overlay };
class WaylandElectronController {
    window;
    state;
    constructor(window, options) {
        this.window = window;
        if (options.position === "parent") {
            throw new Error("The wayland-electron backend does not support parent positioning. Use output/display bounds instead.");
        }
        this.state = {
            overlayXid: 0n,
            parent: null,
            bounds: options.bounds,
            position: options.position,
            clickThrough: options.clickThrough ?? true,
            alwaysOnTop: options.alwaysOnTop ?? true,
            preserveCompositing: options.preserveCompositing ?? true,
            allWorkspaces: options.allWorkspaces ?? false,
            closed: false
        };
        this.reapply();
    }
    assertOpen() {
        if (this.state.closed)
            throw new Error("Overlay controller is closed.");
        if (this.window.isDestroyed?.())
            throw new Error("Electron BrowserWindow is destroyed.");
    }
    attachParent(_query, _options = {}) {
        this.assertOpen();
        return null;
    }
    detachParent() { this.assertOpen(); }
    setBounds(bounds) {
        this.assertOpen();
        this.window.setBounds(bounds);
        this.state.bounds = this.window.getBounds ? validateRect(this.window.getBounds()) : bounds;
    }
    useParentBounds() {
        this.assertOpen();
        return false;
    }
    setClickThrough(enabled) {
        this.assertOpen();
        this.window.setIgnoreMouseEvents(enabled);
        this.state.clickThrough = enabled;
    }
    setAlwaysOnTop(enabled) {
        this.assertOpen();
        this.window.setAlwaysOnTop(enabled);
        this.state.alwaysOnTop = enabled;
    }
    reapply() {
        this.assertOpen();
        this.window.setBounds(this.state.bounds);
        if (this.window.getBounds)
            this.state.bounds = validateRect(this.window.getBounds());
        this.window.setIgnoreMouseEvents(this.state.clickThrough);
        this.window.setAlwaysOnTop(this.state.alwaysOnTop);
        this.window.setVisibleOnAllWorkspaces?.(this.state.allWorkspaces, {
            visibleOnFullScreen: true
        });
    }
    getState() {
        return {
            ...this.state,
            bounds: { ...this.state.bounds }
        };
    }
    close() { this.state.closed = true; }
}
class Win32ElectronController {
    controller;
    window;
    constructor(controller, window, initialBounds) {
        this.controller = controller;
        this.window = window;
        const state = this.controller.getState();
        if (initialBounds)
            this.applyElectronBounds(initialBounds);
        else if (state.position === "parent" && state.parent)
            this.applyElectronBounds(state.parent.bounds);
        this.window.setIgnoreMouseEvents(state.clickThrough);
    }
    applyElectronBounds(bounds) {
        const require = createRequire(import.meta.url);
        const electron = require("electron");
        if (!electron.screen?.screenToDipRect) {
            throw new Error("The Win32 backend requires Electron's screen.screenToDipRect().");
        }
        this.window.setBounds(validateRect(electron.screen.screenToDipRect(null, bounds)));
    }
    attachParent(query, options = {}) {
        const parent = this.controller.attachParent(query, options);
        if (parent && options.reposition)
            this.applyElectronBounds(parent.bounds);
        return parent;
    }
    detachParent() { this.controller.detachParent(); }
    setBounds(bounds) {
        this.controller.setBounds(bounds);
        this.applyElectronBounds(bounds);
    }
    useParentBounds() {
        const adopted = this.controller.useParentBounds();
        const parent = this.controller.getState().parent;
        if (adopted && parent)
            this.applyElectronBounds(parent.bounds);
        return adopted;
    }
    setClickThrough(enabled) {
        this.controller.setClickThrough(enabled);
        this.window.setIgnoreMouseEvents(enabled);
    }
    setAlwaysOnTop(enabled) { this.controller.setAlwaysOnTop(enabled); }
    reapply() { this.controller.reapply(); }
    getState() { return this.controller.getState(); }
    close() { this.controller.close(); }
}
class NativeAddonBackend {
    kind;
    capabilities;
    constructor(kind) {
        this.kind = kind;
        if (kind === "x11" && process.platform !== "linux") {
            throw new Error("The x11 backend is only available on Linux.");
        }
        this.capabilities = CAPABILITIES[kind];
    }
    configure(target, options) {
        const nativeWindowHandle = Buffer.isBuffer(target) ? target : target.getNativeWindowHandle();
        if (!Buffer.isBuffer(nativeWindowHandle) || nativeWindowHandle.length === 0) {
            throw new TypeError("BrowserWindow.getNativeWindowHandle() must return a non-empty Buffer.");
        }
        const nativeOptions = { ...options };
        delete nativeOptions.backend;
        const controller = loadAddon().configure(nativeWindowHandle, nativeOptions);
        return this.kind === "win32" && isBrowserWindowLike(target)
            ? new Win32ElectronController(controller, target, options.position === "bounds" ? options.bounds : undefined)
            : controller;
    }
    findWindow(query) {
        return loadAddon().findWindow(query);
    }
}
class WaylandElectronBackend {
    capabilities = CAPABILITIES["wayland-electron"];
    configure(target, options) {
        if (!isBrowserWindowLike(target)) {
            throw new TypeError("The wayland-electron backend requires the Electron BrowserWindow, not its native handle Buffer.");
        }
        return new WaylandElectronController(target, options);
    }
    findWindow(_query) {
        return null;
    }
}
function getBackend(kind) {
    if (kind === "wayland-electron")
        return new WaylandElectronBackend();
    return new NativeAddonBackend(kind);
}
function isBrowserWindowLike(target) {
    return !Buffer.isBuffer(target)
        && typeof target === "object"
        && target !== null
        && typeof target.getNativeWindowHandle === "function"
        && typeof target.setBounds === "function"
        && typeof target.setIgnoreMouseEvents === "function"
        && typeof target.setAlwaysOnTop === "function";
}
export function configure(target, options) {
    if (!Buffer.isBuffer(target) && !isBrowserWindowLike(target)) {
        throw new TypeError("target must be an Electron BrowserWindow or its getNativeWindowHandle() Buffer.");
    }
    if (Buffer.isBuffer(target) && target.length === 0) {
        throw new TypeError("nativeWindowHandle must be the Buffer returned by BrowserWindow.getNativeWindowHandle().");
    }
    if (options.position === "bounds") {
        if (!options.bounds) {
            throw new TypeError("options.bounds is required when position is 'bounds'.");
        }
        options = { ...options, bounds: validateRect(options.bounds) };
    }
    else if (options.position !== "parent") {
        throw new RangeError("options.position must be 'bounds' or 'parent'.");
    }
    const backend = getBackend(resolveBackend(options.backend ?? "auto", target));
    return new OverlayController(backend.configure(target, options), backend.capabilities);
}
export function findWindow(query, options = {}) {
    const backend = options.backend
        ? getBackend(resolveBackend(options.backend))
        : new NativeAddonBackend(nativeBackendKind());
    return backend.findWindow(query);
}
