/****************************************************************************
**
** Copyright (C) 2018 The Qt Company Ltd.
** Contact: https://www.qt.io/licensing/
**
** This file is part of the plugins of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:GPL$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see https://www.qt.io/terms-conditions. For further
** information use the contact form at https://www.qt.io/contact-us.
**
** GNU General Public License Usage
** Alternatively, this file may be used under the terms of the GNU
** General Public License version 3 or (at your option) any later version
** approved by the KDE Free Qt Foundation. The licenses are as published by
** the Free Software Foundation and appearing in the file LICENSE.GPL3
** included in the packaging of this file. Please review the following
** information to ensure the GNU General Public License requirements will
** be met: https://www.gnu.org/licenses/gpl-3.0.html.
**
** $QT_END_LICENSE$
**
****************************************************************************/

// QtLoader provides javascript API for managing Qt application modules.
//
// QtLoader provides API on top of Emscripten which supports common lifecycle
// tasks such as displaying placeholder content while the module downloads,
// handing application exits, and checking for browser wasm support.
//
// There are two usage modes:
//  * Managed:  QtLoader owns and manages the HTML display elements like
//              the loader and canvas.
//  * External: The embedding HTML page owns the display elements. QtLoader
//              provides event callbacks which the page reacts to.
//
// Managed mode usage:
//
//     var config = {
//         containerElements : [$("container-id")];
//     }
//     var qtLoader = QtLoader(config);
//     qtLoader.loadEmscriptenModule(Module);
//
// External mode.usage:
//
//    var config = {
//        showLoader: function() {
//            loader.style.display = 'block'
//            canvas.style.display = 'hidden'
//        },
//        showCanvas: function() {
//            loader.style.display = 'hidden'
//            canvas.style.display = 'block'
//            return canvas;
//        }
//     }
//     var qtLoader = QtLoader(config);
//     qtLoader.loadEmscriptenModule(Module);
//
// Config keys
//
//  containerElements : [container-element, ...]
//      One or more HTML elements. QtLoader will display loader elements
//      on these while loading the applicaton, and replace the loader with a
//      canvas on load complete.
//  showLoader : function(containerElement)
//      Optional loading element constructor function. Implement to create
//      a custom loading "screen".
//  showCanvas : function(containerElement)
//      Optional canvas constructor function. Implement to create custom
//      canvas elements.
//  showExit : function(crashed, exitCode, containerElement)
//      Optional exited element constructor function.
//  showError : function(crashed, exitCode, containerElement)
//      Optional error element constructor function.
//
//  path : <string>
//      Prefix path for wasm file, realative to the loading HMTL file.
//  restartMode : "DoNotRestart", "RestartOnExit", "RestartOnCrash"
//      Controls whether the application should be reloaded on exits. The default is "DoNotRestart"
//  restartType : "RestartModule", "ReloadPage"
//  restartLimit : <int>
//     Restart attempts limit. The default is 10.
//  stdoutEnabled : <bool>
//  stderrEnabled : <bool>
//  environment : <object>
//     key-value environment variable pairs.
//
// QtLoader object API
//
// webAssemblySupported : bool
// webGLSupported : bool
// canLoadQt : bool
//      Reports if WebAssembly and WebGL are supported. These are requirements for
//      running Qt applications.
// loadEmscriptenModule(createModule)
//      Loads the applicaton from the given emscripten module create function
// status
//      One of "Created", "Loading", "Running", "Exited".
// crashed
//      Set to true if there was an unclean exit.
// exitCode
//      main()/emscripten_force_exit() return code. Valid on status change to
//      "Exited", iff crashed is false.
// exitText
//      Abort/exit message.
function QtLoader(config)
{
    function webAssemblySupported() {
        return typeof WebAssembly !== undefined
    }

    function webGLSupported() {
        // We expect that WebGL is supported if WebAssembly is; however
        // the GPU may be blacklisted.
        try {
            var canvas = document.createElement("canvas");
            return !!(window.WebGLRenderingContext && canvas.getContext("webgl"));
        } catch (e) {
            return false;
        }
    }

    function canLoadQt() {
        // The current Qt implementation requires WebAssembly (asm.js is not in use),
        // and also WebGL (there is no raster fallback).
        return webAssemblySupported() && webGLSupported();
    }

    function removeChildren(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    // Set default state handler functions if needed
    if (config.containerElements !== undefined) {
        config.showError = config.showError || function(errorText, container) {
            removeChildren(container);
            var errorTextElement = document.createElement("text");
            errorTextElement.className = "QtError"
            errorTextElement.innerHTML = errorText;
            return errorTextElement;
        }

        config.showLoader = config.showLoader || function(container) {
            removeChildren(container);
            var loadingText = document.createElement("text");
            loadingText.className = "QtLoading"
            loadingText.innerHTML = "<p><center>Loading Qt ...</center><p>";
            return loadingText;
        };

        config.showCanvas = config.showCanvas || function(container) {
            removeChildren(container);
            var canvas = document.createElement("canvas");
            canvas.className = "QtCanvas"
            canvas.style = "height: 100%; width: 100%;"
            return canvas;
        }

        config.showExit = config.showExit || function(crashed, exitCode, container) {
            console.log("show exit");

            if (!crashed)
                return undefined;

            removeChildren(container);
            var fontSize = 54;
            var crashSymbols = ["\u{1F615}", "\u{1F614}", "\u{1F644}", "\u{1F928}", "\u{1F62C}",
                                "\u{1F915}", "\u{2639}", "\u{1F62E}", "\u{1F61E}", "\u{1F633}"];
            var symbolIndex = Math.floor(Math.random() * crashSymbols.length);
            var errorHtml = `<font size='${fontSize}'> ${crashSymbols[symbolIndex]} </font>`
            var errorElement = document.createElement("text");
            errorElement.className = "QtExit"
            errorElement.innerHTML = errorHtml;
            return errorElement;
        }
    }

    config.restartMode = config.restartMode || "DoNotRestart";
    config.restartLimit = config.restartLimit || 10;

    if (config.stdoutEnabled === undefined) config.stdoutEnabled = true;
    if (config.stderrEnabled === undefined) config.stderrEnabled = true;

    // Make sure config.path is defined and ends with "/" if needed
    if (config.path === undefined)
        config.path = "";
    if (config.path.length > 0 && !config.path.endsWith("/"))
        config.path = config.path.concat("/");

    var publicAPI = {};
    publicAPI.webAssemblySupported = webAssemblySupported();
    publicAPI.webGLSupported = webGLSupported();
    publicAPI.canLoadQt = canLoadQt();
    publicAPI.canLoadApplication = canLoadQt();
    publicAPI.status = undefined;
    publicAPI.crashed = false;
    publicAPI.exitCode = undefined;
    publicAPI.exitText = undefined;
    publicAPI.loadEmscriptenModule = loadEmscriptenModule;

    restartCount = 0;

    function loadEmscriptenModule(createModule) {

        // Check for Wasm & WebGL support; return early before
        if (!webAssemblySupported()) {
            self.error = "Error: WebAssembly is not supported"
            setStatus("Error");
            return;
        }
        if (!webGLSupported()) {
            self.error = "Error: WebGL is not supported"
            setStatus("Error");
            return;
        }

        // Create module object for customization
        var module = {};
        self.module = module;

        module.locateFile = module.locateFile || function(filename) {
            return config.path + filename;
        }

        // Attach status callbacks
        module.setStatus = module.setStatus || function(text) {
            // Currently the only usable status update from this function
            // is "Running..."
            if (text.startsWith("Running"))
                setStatus("Running");
        }
        module.monitorRunDependencies = module.monitorRunDependencies || function(left) {
          //  console.log("monitorRunDependencies " + left)
        }

        // Attach standard out/err callbacks.
        module.print = module.print || function(text) {
            if (config.stdoutEnabled)
                console.log(text)
        }
        module.printErr = module.printErr || function(text) {
            // Filter out OpenGL getProcAddress warnings. Qt tries to resolve
            // all possible function/extension names at startup which causes
            // emscripten to spam the console log with warnings.
            if (text.startsWith !== undefined && text.startsWith("bad name in getProcAddress:"))
                return;

            if (config.stderrEnabled)
                console.log(text)
        }

        // Error handling: set status to "Exited", update crashed and
        // exitCode according to exit type.
        // Emscrjpten will typically call printErr with the error text
        // as well. Note that emscripten may also throw exceptions from
        // async callbacks. These should be handled in window.onerror by user code.
        module.onAbort = module.onAbort || function(text) {
            console.log("abort " + text);

            publicAPI.crashed = true;
            publicAPI.exitText = text;
            setStatus("Exited");
        }
        module.quit = module.quit || function(code, exception) {
            console.log("quit " + code + " " + exception + " " + exception.name);
            if (exception.name == "ExitStatus") {
                // Clean exit with code
                publicAPI.exitCode = code;
            } else {
                publicAPI.exitText = exception.toString();
                publicAPI.crashed = true;
            }
            setStatus("Exited");
        }
        
        // Set environment variables
        Module.preRun = Module.preRun || []
        Module.preRun.push(function() {
            for (let [key, value] of Object.entries(config.environment)) {
                ENV[key.toUpperCase()] = value;
            }                   
        });
        
        config.restart = function() {

            // Restart by reloading the page. This will wipe all state which means
            // reload loops can't be prevented.
            if (config.restartType == "ReloadPage") {
                location.reload();
            }

            // Restart by readling the emscripten app module.
            ++self.restartCount;
            if (self.restartCount > config.restartLimit) {
                self.error = "Error: This application has crashed too many times and has been disabled. Reload the page to try again."
                setStatus("Error");
                return;
            }
            loadEmscriptenModule(createModule);

        }
        publicAPI.exitCode = undefined;
        publicAPI.exitText = undefined;
        publicAPI.crashed = false;
        setStatus("Loading");

        // Finally call emscripten create with our config object
        createModule(module);
    }

    function setErrorContent() {
        if (config.containerElements === undefined) {
            if (config.showError !== undefined)
                config.showError(self.error);
            return;
        }

        for (container of config.containerElements) {
            var errorElement = config.showError(self.error, container);
            container.appendChild(errorElement);
        }
    }

    function setLoaderContent() {
        if (config.containerElements === undefined) {
            if (config.showLoader !== undefined)
                config.showLoader();
            return;
        }

        for (container of config.containerElements) {
            var loaderElement = config.showLoader(container);
            container.appendChild(loaderElement);
        }
    }

    function setCanvasContent() {
        var firstCanvas;
        if (config.containerElements === undefined) {
            firstCanvas = config.showCanvas();
        } else {
            for (container of config.containerElements) {
                var canvasElement = config.showCanvas(container);
                container.appendChild(canvasElement);
            }
            firstCanvas = config.containerElements[0].firstChild;
        }

        if (self.module.canvas === undefined) {
            self.module.canvas = firstCanvas;
        }
    }

    function setExitContent() {

        // publicAPI.crashed = true;

        if (publicAPI.status != "Exited")
            return;

        if (config.containerElements === undefined) {
            if (config.showExit !== undefined)
                config.showExit(publicAPI.crashed, publicAPI.exitCode);
            return;
        }
        
        console.log("setExitContent "  + publicAPI.crashed)

        if (!publicAPI.crashed)
            return;

        for (container of config.containerElements) {
            console.log("call show exit");
            var loaderElement = config.showExit(publicAPI.crashed, publicAPI.exitCode, container);
            if (loaderElement !== undefined)
                container.appendChild(loaderElement);
        }
    }

    var committedStatus = undefined;
    function handleStatusChange() {
        console.log("handleStatusChange pre")

        if (committedStatus == publicAPI.status)
            return;
        committedStatus = publicAPI.status;

        console.log("handleStatusChange")
        if (publicAPI.status == "Error") {
            setErrorContent();
        } else if (publicAPI.status == "Loading") {
            setLoaderContent();
        } else if (publicAPI.status == "Running") {
            setCanvasContent();
        } else if (publicAPI.status == "Exited") {
            console.log("handle exit");
            console.log(config.restartMode);
            if (config.restartMode == "RestartOnExit" ||
                config.restartMode == "RestartOnCrash" && publicAPI.crashed) {
                    committedStatus = undefined;
                    config.restart();
            } else {
                setExitContent();
            }
        }

        // Send status change notification
        console.log(config.statusChanged)
        if (config.statusChanged)
            config.statusChanged(publicAPI.status);
    }

    function setStatus(status) {
        if (publicAPI.status == status)
            return;
        publicAPI.status = status;
        
        console.log("status: " + status + ((status === "Exited" && publicAPI.crashed) ? " (crash)" : ""))

        // There may be multiple calls setStatus("Exited") on exit. Delay handling
        // in order to prevent e.g. transitioning to "loading" in between two calls.
        window.setTimeout(function() { handleStatusChange(); }, 0);

    }

    setStatus("Created");

    return publicAPI;
}
