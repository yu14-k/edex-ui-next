class AudioManager {
    constructor() {
        // howler is loaded as a browser global in the sandboxed renderer (see ui.html)
        const Howl = window.Howl;
        const Howler = window.Howler;
        // Renderer base path (directory containing ui.html), derived from location
        const basePath = window.location.href.slice(0, window.location.href.lastIndexOf("/")) || ".";

        if (window.settings.audio === true) {
            if(window.settings.disableFeedbackAudio === false) {
                this.stdout = new Howl({
                    src: [basePath + "/assets/audio/stdout.wav"],
                    volume: 0.4
                });
                this.stdin = new Howl({
                    src: [basePath + "/assets/audio/stdin.wav"],
                    volume: 0.4
                });
                this.folder = new Howl({
                    src: [basePath + "/assets/audio/folder.wav"]
                });
                this.granted = new Howl({
                    src: [basePath + "/assets/audio/granted.wav"]
                });
            }
            this.keyboard = new Howl({
                src: [basePath + "/assets/audio/keyboard.wav"]
            });
            this.theme = new Howl({
                src: [basePath + "/assets/audio/theme.wav"]
            });
            this.expand = new Howl({
                src: [basePath + "/assets/audio/expand.wav"]
            });
            this.panels = new Howl({
                src: [basePath + "/assets/audio/panels.wav"]
            });
            this.scan = new Howl({
                src: [basePath + "/assets/audio/scan.wav"]
            });
            this.denied = new Howl({
                src: [basePath + "/assets/audio/denied.wav"]
            });
            this.info = new Howl({
                src: [basePath + "/assets/audio/info.wav"]
            });
            this.alarm = new Howl({
                src: [basePath + "/assets/audio/alarm.wav"]
            });
            this.error = new Howl({
                src: [basePath + "/assets/audio/error.wav"]
            });

            Howler.volume(window.settings.audioVolume);
        } else {
            Howler.volume(0.0);
        }

        // Return a proxy to avoid errors if sounds aren't loaded
        return new Proxy(this, {
            get: (target, sound) => {
                if (sound in target) {
                    return target[sound];
                } else {
                    return {
                        play: () => {return true;}
                    }
                }
            }
        });
    }
}

module.exports = {
    AudioManager
};
