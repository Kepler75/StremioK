/* Keep TV proportions on large screens; phones use the responsive layout in style.css. */
(function () {
    'use strict';
    var stage = document.getElementById('tv-stage');
    if (!stage) { return; }

    function enableVideoControls() {
        var video = document.getElementById('html5-player');
        if (window.AndroidApp && typeof AndroidApp.isAndroidApp === 'function' && AndroidApp.isAndroidApp() && video) {
            video.controls = true;
        }
    }

    function fit() {
        if (window.innerWidth <= 900) {
            stage.style.left = '0';
            stage.style.top = '0';
            stage.style.width = '100vw';
            stage.style.height = '100vh';
            stage.style.transform = 'none';
            enableVideoControls();
            return;
        }
        stage.style.width = '1920px';
        stage.style.height = '1080px';
        var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        var width = 1920 * scale, height = 1080 * scale;
        stage.style.left = Math.max(0, (window.innerWidth - width) / 2) + 'px';
        stage.style.top = Math.max(0, (window.innerHeight - height) / 2) + 'px';
        stage.style.transform = 'scale(' + scale + ')';
    }

    fit();
    document.addEventListener('DOMContentLoaded', enableVideoControls, false);
    window.addEventListener('resize', fit, false);
})();