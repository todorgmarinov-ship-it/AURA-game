/**
 * VoiceSynth - Core implementation of "The vOICe" (SeeWithSound) algorithm using Web Audio API.
 * Maps:
 * - Time -> X-axis (Sweep from left to right)
 * - Frequency -> Y-axis (Bottom pixels = low pitch, Top pixels = high pitch)
 * - Amplitude -> Pixel Brightness (White = loud, Black = silent)
 * - Stereo panning -> X-axis (Left side = left panning, Right side = right panning)
 */
class VoiceSynth {
    constructor(numRows = 32, fMin = 100, fMax = 1600) {
        this.numRows = numRows;
        this.fMin = fMin;
        this.fMax = fMax;

        this.ctx = null;
        this.masterGain = null;
        this.panner = null;
        this.oscillators = [];
        this.gainNodes = [];

        this.isScanning = false;
        this.scanIntervalId = null;
        this.sweepDuration = 1.6; // Seconds per sweep
        this.resolutionX = 64;   // Resolution of horizontal scanning columns
        this.resolutionY = numRows; // Resolution of vertical rows

        // Current scan position (0 to resolutionX - 1)
        this.currentCol = 0;
        this.onScanStep = null; // Callback for UI updates (e.g., visual scanline)

        this.isMuted = false;
        this.distance = 1.0; // Distance property for volume attenuation
    }

    /**
     * Initialize Audio Context and Oscillator Bank.
     * Must be called on user interaction (click/keypress) to satisfy browser autoplay policy.
     */
    async init() {
        if (this.ctx) return;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();

        // Create Master Gain for volume control
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Default master volume

        // Create Stereo Panner for spatial audio scan
        if (this.ctx.createStereoPanner) {
            this.panner = this.ctx.createStereoPanner();
            this.panner.connect(this.ctx.destination);
            this.masterGain.connect(this.panner);
        } else {
            this.masterGain.connect(this.ctx.destination);
        }

        // Initialize Oscillator Bank (Logarithmic spacing)
        for (let i = 0; i < this.numRows; i++) {
            // Logarithmic mapping: lower rows = lower frequencies
            const ratio = i / (this.numRows - 1);
            const frequency = this.fMin * Math.pow(this.fMax / this.fMin, ratio);

            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);

            const gainNode = this.ctx.createGain();
            gainNode.gain.setValueAtTime(0, this.ctx.currentTime);

            osc.connect(gainNode);
            gainNode.connect(this.masterGain);

            osc.start(0);

            this.oscillators.push(osc);
            this.gainNodes.push(gainNode);
        }
    }

    /**
     * Set the master volume (0.0 to 1.0)
     */
    setVolume(value) {
        if (!this.masterGain) return;
        const vol = Math.max(0, Math.min(1, value));
        this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }

    /**
     * Set sweep duration in seconds (slower scan = easier to hear details)
     */
    setScanSpeed(seconds) {
        this.sweepDuration = Math.max(0.5, Math.min(5, seconds));
    }

    /**
     * Start the scanning loop.
     * @param {HTMLCanvasElement} renderCanvas The canvas from which we read pixel values.
     */
    start(renderCanvas) {
        if (this.isScanning) return;
        this.isScanning = true;
        
        // Ensure AudioContext is running
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const columnDurationMs = (this.sweepDuration * 1000) / this.resolutionX;

        const scanLoop = () => {
            if (!this.isScanning) return;

            if (this.currentCol === 0) {
                this.playSweepStartTick();
            }

            // Extract brightness profile for the current column
            const brightnessProfile = this.getColumnBrightness(renderCanvas, this.currentCol);
            this.sonifyColumn(brightnessProfile, columnDurationMs / 1000);

            // Update Stereo Panning based on horizontal sweep position
            if (this.panner) {
                const panValue = -1.0 + (2.0 * this.currentCol) / (this.resolutionX - 1);
                this.panner.pan.setTargetAtTime(panValue, this.ctx.currentTime, columnDurationMs / 2000);
            }

            // Callback to update UI scanline
            if (this.onScanStep) {
                this.onScanStep(this.currentCol, this.resolutionX);
            }

            // Move to next column
            this.currentCol = (this.currentCol + 1) % this.resolutionX;

            this.scanIntervalId = setTimeout(scanLoop, columnDurationMs);
        };

        scanLoop();
    }

    /**
     * Stop scanning and silence all oscillators.
     */
    stop() {
        this.isScanning = false;
        if (this.scanIntervalId) {
            clearTimeout(this.scanIntervalId);
            this.scanIntervalId = null;
        }
        this.silenceAll();
    }

    silenceAll() {
        if (!this.gainNodes.length) return;
        const now = this.ctx ? this.ctx.currentTime : 0;
        this.gainNodes.forEach(gn => {
            if (this.ctx) {
                gn.gain.cancelScheduledValues(now);
                gn.gain.setTargetAtTime(0, now, 0.05);
            }
        });
    }

    /**
     * Read canvas pixels in a specific column and calculate average brightness values per row.
     * Grabs a downscaled slice of the canvas.
     */
    getColumnBrightness(canvas, colIndex) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        // Determine coordinates of the vertical slice
        const sliceWidth = Math.max(1, Math.floor(W / this.resolutionX));
        const startX = Math.floor(colIndex * (W / this.resolutionX));
        
        // Grab pixel data for this column slice
        // We will sample pixels vertically at each of our target row positions
        const brightnessValues = new Float32Array(this.resolutionY);

        try {
            const imgData = ctx.getImageData(startX, 0, Math.min(sliceWidth, W - startX), H);
            const data = imgData.data;
            const dataWidth = imgData.width;

            // Loop over each row of our resolution
            for (let r = 0; r < this.resolutionY; r++) {
                // Map the destination row to source pixel Y-range
                const targetYStart = Math.floor(r * (H / this.resolutionY));
                const targetYEnd = Math.floor((r + 1) * (H / this.resolutionY));
                
                let sumBrightness = 0;
                let sampleCount = 0;

                // Average the pixels in this block
                for (let y = targetYStart; y < targetYEnd && y < H; y++) {
                    for (let x = 0; x < dataWidth; x++) {
                        const idx = (y * dataWidth + x) * 4;
                        // RGB to grayscale formula
                        const rVal = data[idx];
                        const gVal = data[idx + 1];
                        const bVal = data[idx + 2];
                        const brightness = (0.299 * rVal + 0.587 * gVal + 0.114 * bVal) / 255.0;
                        sumBrightness += brightness;
                        sampleCount++;
                    }
                }

                // Invert index: row index 0 is bottom (low pitch), index max is top (high pitch)
                const invertedIndex = this.resolutionY - 1 - r;
                brightnessValues[invertedIndex] = sampleCount > 0 ? (sumBrightness / sampleCount) : 0;
            }
        } catch (e) {
            console.error("Canvas read error:", e);
        }

        return brightnessValues;
    }

    /**
     * Map the brightness values to the volume of corresponding oscillators.
     * @param {Float32Array} brightnessArray Values from 0.0 (black) to 1.0 (white).
     * @param {number} rampTime Time to transition to new volume values.
     */
    sonifyColumn(brightnessArray, rampTime) {
        if (!this.ctx || this.isMuted) return;

        const now = this.ctx.currentTime;
        // Total gain scaling to avoid clipping (increased for higher volume)
        const baseGain = 0.6 / this.numRows;
        // Attenuate volume based on distance (closer = louder, further = quieter)
        const distanceAtten = Math.max(0.1, Math.min(2.5, 1.0 / this.distance));

        // Noise gate threshold: values below this are treated as absolute silence
        const threshold = 0.05;

        for (let i = 0; i < this.numRows; i++) {
            const brightness = brightnessArray[i];
            
            let targetGain = 0;
            if (brightness > threshold) {
                // Map the brightness range above threshold [threshold, 1.0] to [0, 1.0]
                const normalizedBrightness = (brightness - threshold) / (1.0 - threshold);
                targetGain = Math.pow(normalizedBrightness, 1.8) * baseGain * distanceAtten;
            }

            const gn = this.gainNodes[i];
            gn.gain.cancelScheduledValues(now);
            gn.gain.setValueAtTime(gn.gain.value, now);
            gn.gain.linearRampToValueAtTime(targetGain, now + rampTime);
        }
    }

    /**
     * Play correct/incorrect audio feedback chime
     */
    playFeedback(isCorrect) {
        if (!this.ctx) return;
        
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        gain.gain.setValueAtTime(0, now);
        
        if (isCorrect) {
            // Clean ascending major chime (C-major triad or arpeggio)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
            osc.frequency.setValueAtTime(1046.50, now + 0.24); // C6

            gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
            gain.gain.setValueAtTime(0.15, now + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
            osc.start(now);
            osc.stop(now + 0.65);
        } else {
            // Low dissonant warning buzzer
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(110.00, now); // A2
            osc.frequency.setValueAtTime(115.00, now + 0.05); // slight pitch modulation

            gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
            gain.gain.setValueAtTime(0.1, now + 0.25);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.4);
        }
    }

    /**
     * Play a very short, light, low-volume tick when the sweep starts from the left.
     * Connected to masterGain to be panned automatically to the left.
     */
    playSweepStartTick() {
        if (!this.ctx || this.isMuted || !this.masterGain) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, now);
        
        // Very quiet tick (barely audible click)
        gain.gain.setValueAtTime(0.015, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
        
        osc.start(now);
        osc.stop(now + 0.015);
    }
}
