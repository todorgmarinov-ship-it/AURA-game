/**
 * AURA - Main Application Logic
 * Integrates VoiceSynth, ShapeRenderer, Game Flow, Input, PWA, and Accessibility.
 */

// Automatically unregister service workers and clear cache to force updates
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        if (registrations.length > 0) {
            for (let registration of registrations) {
                registration.unregister();
            }
            if (window.caches) {
                caches.keys().then(names => {
                    for (let name of names) caches.delete(name);
                });
            }
            setTimeout(() => {
                window.location.reload();
            }, 600);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Core engine instances
    const synth = new VoiceSynth(32, 120, 1600); // 32 frequency bands, 120Hz to 1600Hz
    const renderer = new ShapeRenderer('viewport-canvas');
    const hiddenCanvas = document.getElementById('hidden-scanner-canvas');

    // UI elements
    const scoreVal = document.getElementById('current-score');
    const highScoreVal = document.getElementById('high-score');
    const streakCounter = document.getElementById('streak-counter');
    const progressFill = document.getElementById('lesson-progress-fill');
    const lessonTitle = document.getElementById('current-lesson-title');
    const blindModeToggle = document.getElementById('blind-mode-toggle');
    const ttsToggle = document.getElementById('tts-toggle');
    const contourToggle = document.getElementById('contour-toggle');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeVal = document.getElementById('volume-val');
    const speedSlider = document.getElementById('speed-slider');
    const speedVal = document.getElementById('speed-val');
    const scanStatus = document.getElementById('scan-status');
    const distanceDisplay = document.getElementById('current-distance');

    // Spectrogram Canvas
    const specCanvas = document.getElementById('spectrogram-canvas');
    const specCtx = specCanvas.getContext('2d');

    // Escape Menu
    const escapeMenu = document.getElementById('escape-menu');
    const closeMenuBtn = document.getElementById('btn-close-menu');
    let isMenuOpen = false;

    const mazeGrid = [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1, 0, 0, 1],
        [1, 0, 1, 0, 1, 0, 1, 1],
        [1, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 1, 1, 1, 1, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 1],
        [1, 1, 1, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1]
    ];

    function isPositionWalkable(x, y) {
        const radius = 0.22;
        const testPoints = [
            { x: x, y: y },
            { x: x - radius, y: y },
            { x: x + radius, y: y },
            { x: x, y: y - radius },
            { x: x, y: y + radius }
        ];
        
        for (let pt of testPoints) {
            const gx = Math.round(pt.x + 3.5);
            const gy = Math.round(pt.y + 3.5);
            
            if (gx < 0 || gx >= 8 || gy < 0 || gy >= 8) {
                return false;
            }
            if (mazeGrid[gy][gx] === 1) {
                return false;
            }
        }
        return true;
    }

    function toggleEscapeMenu(open) {
        isMenuOpen = open;
        if (open) {
            escapeMenu.style.display = 'flex';
            synth.stop();
            speak("Меню за избор на ниво. Натиснете от 1 до 5 за избор или ескейп за затваряне.");
        } else {
            escapeMenu.style.display = 'none';
            if (isInitialized) {
                synth.start(hiddenCanvas);
            }
        }
    }

    // Game state variables
    let currentLesson = 1;
    let score = 0;
    let highScore = 0;
    let streak = 0;
    let currentShape = 'triangle';
    let progress = 0; // 0 to 100
    let distance = 1.0; // Current distance to shape (0.4m to 2.5m)
    let isInitialized = false;

    // Spatial game mode state (Lesson 4)
    let playerX = 0;
    let playerY = 0;
    let gameShapes = [];
    let collectedCount = 0;

    // Movement step sizes for orientation
    const YAW_STEP = 10; // Degrees per rotation tap
    const DISTANCE_STEP = 0.2; // Meters per depth tap
    let lastTtsTime = 0; // To throttle TTS reading distance

    const answerToShape = {
        '1': 'square',
        '2': 'triangle',
        '3': 'circle',
        '4': 'horizontal_line',
        '5': 'vertical_line',
        'r': 'diagonal_up_45',
        'р': 'diagonal_up_45',
        't': 'diagonal_down_45',
        'т': 'diagonal_down_45',
        'o': 'rectangle_horizontal',
        'о': 'rectangle_horizontal',
        'p': 'rectangle_vertical',
        'п': 'rectangle_vertical',
        'v': 'rhombus',
        'в': 'rhombus',
        'i': 'inverted_triangle',
        'и': 'inverted_triangle'
    };

    const shapeToNameBG = {
        'square': 'Квадрат',
        'triangle': 'Триъгълник',
        'circle': 'Кръг',
        'horizontal_line': 'Хоризонтална линия',
        'vertical_line': 'Вертикална линия',
        'diagonal_up_45': 'Наклонена линия десен нагоре 45 градуса',
        'diagonal_down_45': 'Наклонена линия ляв нагоре 45 градуса',
        'diagonal_up_25': 'Наклонена линия десен нагоре 25 градуса',
        'diagonal_down_25': 'Наклонена линия ляв нагоре 25 градуса',
        'rectangle_horizontal': 'Легнал правоъгълник',
        'rectangle_vertical': 'Изправен правоъгълник',
        'rhombus': 'Ромб',
        'inverted_triangle': 'Обърнат триъгълник'
    };

    const lessonShapes = {
        1: ['horizontal_line', 'vertical_line', 'diagonal_up_45', 'diagonal_down_45', 'diagonal_up_25', 'diagonal_down_25'],
        2: ['square', 'triangle', 'circle', 'rectangle_horizontal', 'rectangle_vertical', 'rhombus', 'inverted_triangle'],
        3: ['square', 'triangle', 'circle', 'rectangle_horizontal', 'rectangle_vertical', 'rhombus', 'inverted_triangle', 'horizontal_line', 'vertical_line', 'diagonal_up_45', 'diagonal_down_45', 'diagonal_up_25', 'diagonal_down_25']
    };

    // ==========================================
    // AUDIO AUDITORY BEEPS (CLICK SOUNDS)
    // ==========================================
    function playStepClick(frequency = 800) {
        if (!synth.ctx) return;
        const now = synth.ctx.currentTime;
        const osc = synth.ctx.createOscillator();
        const gain = synth.ctx.createGain();
        osc.connect(gain);
        gain.connect(synth.ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now);
        
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        
        osc.start(now);
        osc.stop(now + 0.05);
    }

    function playWallBumpSizzle() {
        if (!synth.ctx) return;
        const now = synth.ctx.currentTime;
        const bufferSize = synth.ctx.sampleRate * 0.35; // 0.35 seconds
        const buffer = synth.ctx.createBuffer(1, bufferSize, synth.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        // Read current volume from slider (0.0 to 1.0)
        const sliderVol = volumeSlider.value / 100;
        const masterVolume = synth.masterGain ? synth.masterGain.gain.value : sliderVol;
        
        // Fill buffer with white noise modulated by a crackling/sizzling envelope
        for (let i = 0; i < bufferSize; i++) {
            const t = i / synth.ctx.sampleRate;
            // Base white noise
            let noise = Math.random() * 2.0 - 1.0;
            
            // Sizzle effect: modulate amplitude with rapid random impulses (crackling)
            const sizzleMod = Math.random() > 0.15 ? 1.0 : 0.05;
            
            // Gain decay envelope
            const env = Math.exp(-9.0 * t);
            
            data[i] = noise * sizzleMod * env;
        }
        
        const noiseNode = synth.ctx.createBufferSource();
        noiseNode.buffer = buffer;
        
        // Highpass/Bandpass filter to make it sound like a bright electrical spark/sizzle
        const filter = synth.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1800, now);
        filter.Q.setValueAtTime(3.0, now);
        
        // Add a second oscillator for a loud low/mid-frequency "thud/impact" sound underneath the sizzle
        const osc = synth.ctx.createOscillator();
        const oscGain = synth.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
        oscGain.gain.setValueAtTime(0.4 * masterVolume, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        
        const gainNode = synth.ctx.createGain();
        // Sizzling volume should be loud, scaled by master volume
        gainNode.gain.setValueAtTime(0.8 * masterVolume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        
        noiseNode.connect(filter);
        filter.connect(gainNode);
        
        osc.connect(oscGain);
        
        // Connect both to destination
        gainNode.connect(synth.ctx.destination);
        oscGain.connect(synth.ctx.destination);
        
        noiseNode.start(now);
        osc.start(now);
        
        noiseNode.stop(now + 0.4);
        osc.stop(now + 0.4);
    }

    // ==========================================
    // SPEECH SYNTHESIS (TTS)
    // ==========================================
    function speak(text, force = true) {
        if (!ttsToggle.checked) return;
        
        const now = Date.now();
        // Throttle speech for rapid continuous taps unless forced
        if (!force && (now - lastTtsTime < 1500)) return;
        lastTtsTime = now;

        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'bg-BG';
        
        const voices = window.speechSynthesis.getVoices();
        const bgVoice = voices.find(v => v.lang.includes('bg') || v.lang.includes('BG'));
        if (bgVoice) {
            utterance.voice = bgVoice;
        }
        
        utterance.rate = 1.1;
        window.speechSynthesis.speak(utterance);
    }

    // ==========================================
    // INITIALIZATION & MODAL
    // ==========================================
    const introModal = document.getElementById('intro-modal');
    const startBtn = document.getElementById('btn-start-app');

    function startApp() {
        if (isInitialized) return;
        isInitialized = true;
        
        introModal.style.display = 'none';

        synth.init().then(() => {
            synth.setVolume(volumeSlider.value / 100);
            synth.setScanSpeed(speedSlider.value / 10);

            // Connect scanning step callback
            synth.onScanStep = (col, totalCols) => {
                const percentage = (col / totalCols) * 100;
                document.getElementById('visual-scanline').style.left = `${percentage}%`;
                drawSpectrogramColumn(col, totalCols);
            };

            // Set shape options
            renderer.setContourMode(contourToggle.checked);
            updateDistance(1.0);

            // Start scanning loop
            synth.start(hiddenCanvas);

            loadNewShape();
            
            speak("Лаборатория Аура стартирана. Урок едно: линии. Използвайте бутоните за навигация.");
        });
    }

    startBtn.addEventListener('click', startApp);
    window.addEventListener('keydown', (e) => {
        if (!isInitialized && (e.key === 'Enter' || e.key === ' ')) {
            startApp();
            e.preventDefault();
        }
    });

    // ==========================================
    // DEPTH AND CAMERA MOVEMENT FUNCTIONS
    // ==========================================
    function updateDistance(newDist, spokenAnnounce = false) {
        distance = Math.max(0.4, Math.min(2.5, newDist));
        
        // Update both engines
        renderer.setDistance(distance);
        synth.distance = distance;
        
        // Update UI display
        distanceDisplay.textContent = `${distance.toFixed(1)}м`;

        // Visual render update
        renderer.render(hiddenCanvas);

        if (spokenAnnounce) {
            const distWord = distance.toFixed(1).replace('.', ',');
            speak(`${distance < 1.0 ? 'Близо' : 'Далеч'}: ${distWord} метра`, false);
        }
    }

    function moveCameraYaw(offset) {
        const nextYaw = renderer.cameraYaw + offset;
        renderer.setCameraYaw(nextYaw);
        
        // Visual render update
        renderer.render(hiddenCanvas);
        
        if (currentLesson === 4 || currentLesson === 6) {
            checkCollection();
        }
    }

    // ==========================================
    // SPATIAL GAME MODE HELPER FUNCTIONS (LESSON 4)
    // ==========================================
    function getShapeNameBG(shape) {
        const localShapeToNameBG = {
            'square': 'квадрат',
            'triangle': 'триъгълник',
            'circle': 'кръг',
            'horizontal_line': 'хоризонтална линия',
            'vertical_line': 'вертикална линия',
            'diagonal_up_45': 'наклонена линия десен нагоре 45 градуса',
            'diagonal_down_45': 'наклонена линия ляв нагоре 45 градуса',
            'diagonal_up_25': 'наклонена линия десен нагоре 25 градуса',
            'diagonal_down_25': 'наклонена линия ляв нагоре 25 градуса',
            'rectangle_horizontal': 'легнал правоъгълник',
            'rectangle_vertical': 'изправен правоъгълник',
            'rhombus': 'ромб',
            'inverted_triangle': 'обърнат триъгълник'
        };
        const lines = ['horizontal_line', 'vertical_line', 'diagonal_up_45', 'diagonal_down_45', 'diagonal_up_25', 'diagonal_down_25'];
        if (lines.includes(shape.type)) {
            return localShapeToNameBG[shape.type];
        }
        return (shape.isContourMode ? 'контурен ' : 'плътен ') + localShapeToNameBG[shape.type];
    }

    function speakDirectionHint() {
        if (currentLesson !== 4 && currentLesson !== 6) return;
        const targetShape = gameShapes.find(s => s.isTarget && !s.isCollected);
        if (!targetShape) return;
        
        const dx = targetShape.x - playerX;
        const dy = targetShape.y - playerY;
        
        let angle = Math.atan2(dx, dy) * 180 / Math.PI;
        let diffYaw = angle - renderer.cameraYaw;
        diffYaw = ((diffYaw + 180) % 360 + 360) % 360 - 180;
        
        let word = "";
        if (Math.abs(diffYaw) <= 25) {
            word = "напред";
        } else if (Math.abs(diffYaw) > 155) {
            word = "назад";
        } else if (diffYaw > 25 && diffYaw <= 155) {
            word = "дясно";
        } else {
            word = "ляво";
        }
        
        speak(word);
    }

    function speakTargetReminder() {
        if (currentLesson !== 4 && currentLesson !== 6) return;
        const targetShape = gameShapes.find(s => s.isTarget && !s.isCollected);
        if (!targetShape) return;
        const name = getShapeNameBG(targetShape);
        speak(`Търсим: ${name}`);
    }

    function updateTargetDistanceDisplay() {
        if (currentLesson === 4 || currentLesson === 6) {
            const targetShape = gameShapes.find(s => s.isTarget && !s.isCollected);
            if (targetShape) {
                const dx = targetShape.x - playerX;
                const dy = targetShape.y - playerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                distanceDisplay.textContent = `${dist.toFixed(1)}м`;
            } else {
                distanceDisplay.textContent = `--`;
            }
        } else {
            distanceDisplay.textContent = `--`;
        }
    }

    function movePlayer(direction) {
        const stepSize = 0.2;
        const rad = (renderer.cameraYaw * Math.PI) / 180;
        
        const nextX = playerX + direction * Math.sin(rad) * stepSize;
        const nextY = playerY + direction * Math.cos(rad) * stepSize;
        
        if (currentLesson === 5 || currentLesson === 6) {
            if (!isPositionWalkable(nextX, nextY)) {
                playWallBumpSizzle(); // play custom synthesized sizzling collision sound
                return;
            }
        } else {
            // Boundary check: radius 3.5m
            if (nextX * nextX + nextY * nextY > 3.5 * 3.5) {
                playStepClick(200); // low pitch bump click
                speak("Граница на зоната", false);
                return;
            }
        }
        
        playerX = nextX;
        playerY = nextY;
        
        renderer.setPlayerPosition(playerX, playerY);
        synth.distance = 1.0;
        
        renderer.render(hiddenCanvas);
        checkCollection();
        updateTargetDistanceDisplay();
    }

    function checkCollection() {
        if (currentLesson === 5) return; // training level has no collection
        
        const targetShape = gameShapes.find(s => s.isTarget && !s.isCollected);
        if (!targetShape) return;
        
        const dx = targetShape.x - playerX;
        const dy = targetShape.y - playerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        let angle = Math.atan2(dx, dy) * 180 / Math.PI;
        let diffYaw = angle - renderer.cameraYaw;
        diffYaw = ((diffYaw + 180) % 360 + 360) % 360 - 180;
        
        if (dist < 0.5 && Math.abs(diffYaw) <= 25) {
            targetShape.isCollected = true;
            collectedCount++;
            
            score += 20;
            scoreVal.textContent = score;
            if (score > highScore) {
                highScore = score;
                highScoreVal.textContent = highScore;
            }
            
            progress = Math.min(100, (collectedCount / 10) * 100);
            progressFill.style.width = `${progress}%`;
            
            synth.playFeedback(true);
            
            if (collectedCount >= 10) {
                if (currentLesson === 6) {
                    speak(`Поздравления! Вие събрахте всички десет фигури в лабиринта и спечелихте играта! Общ резултат: ${score} точки.`);
                } else {
                    speak(`Поздравления! Вие събрахте всички десет фигури и спечелихте играта! Общ резултат: ${score} точки.`);
                }
                setTimeout(() => {
                    selectLesson(1);
                }, 3000);
            } else {
                const shapeName = getShapeNameBG(targetShape);
                
                // Choose next target shape
                const uncollected = gameShapes.filter(s => !s.isCollected);
                const nextIndex = Math.floor(Math.random() * uncollected.length);
                uncollected[nextIndex].isTarget = true;
                
                const nextShapeName = getShapeNameBG(uncollected[nextIndex]);
                speak(`Събрахте ${shapeName}! Остават ${10 - collectedCount} фигури. Намерете ${nextShapeName}.`);
                
                renderer.render(hiddenCanvas);
                updateTargetDistanceDisplay();
            }
        }
    }

    function selectLesson(lessonNum) {
        currentLesson = lessonNum;
        progress = 0;
        progressFill.style.width = `0%`;
        
        document.querySelectorAll('.btn-lesson').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(`btn-lesson-${lessonNum}`);
        if (activeBtn) activeBtn.classList.add('active');

        if (currentLesson === 5 || currentLesson === 6) {
            renderer.setMazeGrid(mazeGrid);
        } else {
            renderer.setMazeGrid(null);
        }

        if (currentLesson === 1) {
            lessonTitle.textContent = "Урок 1: Основни линии";
        } else if (currentLesson === 2) {
            lessonTitle.textContent = "Урок 2: Прости фигури";
        } else if (currentLesson === 3) {
            lessonTitle.textContent = "Урок 3: Тест-предизвикателство";
        } else if (currentLesson === 4) {
            lessonTitle.textContent = "Игра: Лов на фигури";
        } else if (currentLesson === 5) {
            lessonTitle.textContent = "Урок 5: Обучение в лабиринт";
        } else if (currentLesson === 6) {
            lessonTitle.textContent = "Урок 6: Лов в лабиринт";
        }

        loadNewShape();
    }

    // ==========================================
    // GAME CORE LOGIC
    // ==========================================
    function loadNewShape() {
        if (currentLesson === 5) {
            // Training Level: Walk in empty corridors, no shapes spawned
            playerX = -2.5; // (1,1) grid slot center
            playerY = -2.5;
            renderer.setPlayerPosition(playerX, playerY);
            renderer.setCameraYaw(0);
            
            collectedCount = 0;
            progress = 0;
            progressFill.style.width = `0%`;
            
            gameShapes = [];
            renderer.setShapes([]);
            
            distanceDisplay.textContent = `--`;
            
            speak(`Старт на Обучение в лабиринт! Навигирайте по празните коридори за упражнение.`);
            
            clearSpectrogram();
            renderer.render(hiddenCanvas);
            return;
        }

        if (currentLesson === 4 || currentLesson === 6) {
            // Reset player position & yaw
            if (currentLesson === 6) {
                playerX = -2.5; // (1,1) grid slot center
                playerY = -2.5;
            } else {
                playerX = 0;
                playerY = 0;
            }
            renderer.setPlayerPosition(playerX, playerY);
            renderer.setCameraYaw(0);
            
            collectedCount = 0;
            progress = 0;
            progressFill.style.width = `0%`;
            
            // Spawn 10 shapes
            gameShapes = [];
            const shapeTypes = [
                'square', 'triangle', 'circle', 
                'rectangle_horizontal', 'rectangle_vertical', 
                'rhombus', 'inverted_triangle', 
                'horizontal_line', 'vertical_line', 
                'diagonal_up_45', 'diagonal_down_45', 
                'diagonal_up_25', 'diagonal_down_25'
            ];
            
            if (currentLesson === 6) {
                // Find all walkable cells except (1, 1) where player starts
                const walkableCells = [];
                for (let gy = 0; gy < mazeGrid.length; gy++) {
                    for (let gx = 0; gx < mazeGrid[gy].length; gx++) {
                        if (mazeGrid[gy][gx] === 0 && !(gx === 1 && gy === 1)) {
                            walkableCells.push({ gx, gy });
                        }
                    }
                }
                
                // Shuffle walkable cells using Fisher-Yates
                for (let i = walkableCells.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const temp = walkableCells[i];
                    walkableCells[i] = walkableCells[j];
                    walkableCells[j] = temp;
                }
                
                // Spawn in the first 10 random walkable cells
                const selectedCells = walkableCells.slice(0, 10);
                for (let i = 0; i < 10; i++) {
                    const type = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
                    const isContour = (type.includes('line') || type.includes('diagonal')) ? true : (Math.random() > 0.5);
                    const cell = selectedCells[i];
                    
                    gameShapes.push({
                        type: type,
                        x: -3.5 + cell.gx,
                        y: -3.5 + cell.gy,
                        isContourMode: isContour,
                        isCollected: false,
                        isTarget: false
                    });
                }
            } else {
                for (let i = 0; i < 10; i++) {
                    // Pick random type
                    const type = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
                    
                    // For simple lines, they are always contour. For other shapes, pick random contour or solid.
                    const isContour = (type.includes('line') || type.includes('diagonal')) ? true : (Math.random() > 0.5);
                    
                    let x, y, dist, angle, attempts = 0;
                    let tooClose = true;
                    
                    while (tooClose && attempts < 100) {
                        dist = 1.0 + Math.random() * 1.8; // distance 1.0 to 2.8m
                        angle = Math.random() * 360;
                        x = dist * Math.sin(angle * Math.PI / 180);
                        y = dist * Math.cos(angle * Math.PI / 180);
                        
                        tooClose = false;
                        // Check distance from player start position (0,0) - must be at least 0.8m
                        if (dist < 0.8) {
                            tooClose = true;
                        }
                        
                        // Check distance from other shapes
                        for (let other of gameShapes) {
                            const dx = x - other.x;
                            const dy = y - other.y;
                            if (Math.sqrt(dx*dx + dy*dy) < 0.6) {
                                tooClose = true;
                                break;
                            }
                        }
                        attempts++;
                    }
                    
                    gameShapes.push({
                        type: type,
                        x: x,
                        y: y,
                        isContourMode: isContour,
                        isCollected: false,
                        isTarget: false
                    });
                }
            }
            
            // Pick the first target shape
            const targetIndex = Math.floor(Math.random() * 10);
            gameShapes[targetIndex].isTarget = true;
            
            renderer.setShapes(gameShapes);
            synth.distance = 1.0;
            
            updateTargetDistanceDisplay();
            
            const targetShape = gameShapes[targetIndex];
            const targetName = getShapeNameBG(targetShape);
            if (currentLesson === 6) {
                speak(`Старт на Лов в лабиринт! Намерете ${targetName} в лабиринта.`);
            } else {
                speak(`Старт на Лов на фигури! Намерете ${targetName}`);
            }
            
            clearSpectrogram();
            renderer.render(hiddenCanvas);
            return;
        }

        // Lessons 1-3 load logic:
        const shapes = lessonShapes[currentLesson];
        const randomIndex = Math.floor(Math.random() * shapes.length);
        currentShape = shapes[randomIndex];

        renderer.setShape(currentShape);
        updateDistance(1.0); // Reset distance to default

        if (currentLesson === 3) {
            // Exam Mode: Randomize camera yaw and distance to encourage spatial orientation search
            const randomYaw = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 25);
            renderer.setCameraYaw(randomYaw);

            const randomDist = 0.8 + Math.random() * 1.2; // between 0.8m and 2.0m
            updateDistance(randomDist);

            speak("Нова фигура. Намерете я в пространството.");
        } else {
            renderer.setCameraYaw(0);
            const shapeName = shapeToNameBG[currentShape];
            speak(`Намерете звуковия профил за ${shapeName}`);
        }

        clearSpectrogram();
        renderer.render(hiddenCanvas);
    }

    function checkAnswer(answerCode) {
        if (!isInitialized) return;

        if (currentLesson === 4 || currentLesson === 5 || currentLesson === 6) {
            speak("В този режим се движете с бутоните за навигация.");
            return;
        }

        const lowerKey = answerCode.toLowerCase();
        
        let isCorrect = false;
        let engKey = lowerKey;
        
        // Map Bulgarian keys to their English equivalent button IDs for flash animations
        const keyToEnglishId = {
            '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
            'r': 'r', 'р': 'r',
            't': 't', 'т': 't',
            'o': 'o', 'о': 'o',
            'p': 'p', 'п': 'p',
            'v': 'v', 'в': 'v',
            'i': 'i', 'и': 'i'
        };
        engKey = keyToEnglishId[lowerKey] || lowerKey;

        // Perform grouping logic for diagonal lines:
        if ((lowerKey === 'r' || lowerKey === 'р') && (currentShape === 'diagonal_up_45' || currentShape === 'diagonal_up_25')) {
            isCorrect = true;
        } else if ((lowerKey === 't' || lowerKey === 'т') && (currentShape === 'diagonal_down_45' || currentShape === 'diagonal_down_25')) {
            isCorrect = true;
        } else if ((lowerKey === 'i' || lowerKey === 'и') && currentShape === 'inverted_triangle') {
            isCorrect = true;
        } else if ((lowerKey === 'o' || lowerKey === 'о') && currentShape === 'rectangle_horizontal') {
            isCorrect = true;
        } else if ((lowerKey === 'p' || lowerKey === 'п') && currentShape === 'rectangle_vertical') {
            isCorrect = true;
        } else if ((lowerKey === 'v' || lowerKey === 'в') && currentShape === 'rhombus') {
            isCorrect = true;
        } else {
            // Default 1-5 number keys fallback
            const guessedShape = answerToShape[lowerKey];
            if (guessedShape && guessedShape === currentShape) {
                isCorrect = true;
            }
        }

        const btn = document.getElementById(`btn-ans-${engKey}`);

        if (isCorrect) {
            score += 10;
            streak++;
            if (score > highScore) {
                highScore = score;
                highScoreVal.textContent = highScore;
            }
            scoreVal.textContent = score;
            streakCounter.textContent = `Серия: ${streak} 🔥`;

            if (btn) {
                btn.classList.add('correct-flash');
                setTimeout(() => btn.classList.remove('correct-flash'), 500);
            }

            synth.playFeedback(true);
            speak(`Вярно! Това е ${shapeToNameBG[currentShape]}.`);

            progress = Math.min(100, progress + 20);
            progressFill.style.width = `${progress}%`;

            if (progress >= 100) {
                setTimeout(() => {
                    advanceLesson();
                }, 1000);
            } else {
                setTimeout(() => {
                    loadNewShape();
                }, 1200);
            }
        } else {
            streak = 0;
            streakCounter.textContent = `Серия: 0 🔥`;

            if (btn) {
                btn.classList.add('wrong-flash');
                setTimeout(() => btn.classList.remove('wrong-flash'), 500);
            }

            synth.playFeedback(false);
            speak("Грешно! Опитайте отново.");
        }
    }

    function advanceLesson() {
        progress = 0;
        progressFill.style.width = `0%`;

        if (currentLesson < 3) {
            currentLesson++;
            
            document.querySelectorAll('.btn-lesson').forEach(b => b.classList.remove('active'));
            document.getElementById(`btn-lesson-${currentLesson}`).classList.add('active');

            if (currentLesson === 2) {
                lessonTitle.textContent = "Урок 2: Прости фигури";
                speak("Страхотно! Преминавате към Урок две. Контури на квадрат, триъгълник и кръг.");
            } else if (currentLesson === 3) {
                lessonTitle.textContent = "Урок 3: Тест-предизвикателство";
                speak("Браво! Влизате в режим Тест. Използвайте бутоните за напред, назад, наляво и надясно за ориентация.");
            }
        } else {
            speak("Поздравления! Вие овладяхте сетивното звуково разпознаване.");
            score += 100;
            scoreVal.textContent = score;
        }

        setTimeout(() => {
            loadNewShape();
        }, 2200);
    }

    // ==========================================
    // KEYBOARD NAVIGATION INPUT HANDLER
    // ==========================================
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!isInitialized) return;
            toggleEscapeMenu(!isMenuOpen);
            e.preventDefault();
            return;
        }

        if (isMenuOpen) {
            if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4' || e.key === '5' || e.key === '6') {
                const level = parseInt(e.key);
                selectLesson(level);
                toggleEscapeMenu(false);
                e.preventDefault();
            }
            return;
        }

        if (!isInitialized) return;

        let actionTriggered = false;

        switch (e.key) {
            // Turn Left
            case 'ArrowLeft':
            case 'a':
            case 'A':
                moveCameraYaw(-YAW_STEP);
                playStepClick(800); // High pitch click for rotation
                highlightKeyIndicator('key-ArrowLeft');
                highlightKeyIndicator('key-a');
                highlightDpadButton('btn-nav-left');
                actionTriggered = true;
                break;
            
            // Turn Right
            case 'ArrowRight':
            case 'd':
            case 'D':
                moveCameraYaw(YAW_STEP);
                playStepClick(800);
                highlightKeyIndicator('key-ArrowRight');
                highlightKeyIndicator('key-d');
                highlightDpadButton('btn-nav-right');
                actionTriggered = true;
                break;

            // Move Forward (Closer)
            case 'ArrowUp':
            case 'w':
            case 'W':
                if (currentLesson === 4 || currentLesson === 5 || currentLesson === 6) {
                    movePlayer(1);
                } else {
                    updateDistance(distance - DISTANCE_STEP, false);
                }
                playStepClick(450); // Deeper pitch click for distance step
                highlightKeyIndicator('key-ArrowUp');
                highlightKeyIndicator('key-w');
                highlightDpadButton('btn-nav-up');
                actionTriggered = true;
                break;

            // Move Backward (Further)
            case 'ArrowDown':
            case 's':
            case 'S':
                if (currentLesson === 4 || currentLesson === 5 || currentLesson === 6) {
                    movePlayer(-1);
                } else {
                    updateDistance(distance + DISTANCE_STEP, false);
                }
                playStepClick(450);
                highlightKeyIndicator('key-ArrowDown');
                highlightKeyIndicator('key-s');
                highlightDpadButton('btn-nav-down');
                actionTriggered = true;
                break;

            // Hint Direction (E / Bulgarian Е)
            case 'e':
            case 'E':
            case 'е':
            case 'Е':
                speakDirectionHint();
                highlightDpadButton('btn-hint-direction');
                actionTriggered = true;
                break;
                
            // Hint Target Reminder (F / Bulgarian Ф)
            case 'f':
            case 'F':
            case 'ф':
            case 'Ф':
                speakTargetReminder();
                highlightDpadButton('btn-hint-target');
                actionTriggered = true;
                break;
        }

        if (actionTriggered) {
            e.preventDefault();
        }

        // Answer keys
        // Answer keys (both numbers and letters)
        const lowerKey = e.key.toLowerCase();
        const validAnswerKeys = [
            '1', '2', '3', '4', '5',
            'r', 'р', 't', 'т', 'o', 'о', 'p', 'п', 'v', 'в', 'i', 'и'
        ];
        if (validAnswerKeys.includes(lowerKey)) {
            const keyToEnglishId = {
                '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
                'r': 'r', 'р': 'r',
                't': 't', 'т': 't',
                'o': 'o', 'о': 'o',
                'p': 'p', 'п': 'p',
                'v': 'v', 'в': 'v',
                'i': 'i', 'и': 'i'
            };
            const engKey = keyToEnglishId[lowerKey];
            const ansBtn = document.getElementById(`btn-ans-${engKey}`);
            if (ansBtn) ansBtn.classList.add('active');
            checkAnswer(lowerKey);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (!isInitialized) return;

        // Remove active styles
        removeKeyHighlight('key-ArrowLeft');
        removeKeyHighlight('key-a');
        removeKeyHighlight('key-ArrowRight');
        removeKeyHighlight('key-d');
        removeKeyHighlight('key-ArrowUp');
        removeKeyHighlight('key-w');
        removeKeyHighlight('key-ArrowDown');
        removeKeyHighlight('key-s');

        removeDpadHighlight('btn-nav-left');
        removeDpadHighlight('btn-nav-right');
        removeDpadHighlight('btn-nav-up');
        removeDpadHighlight('btn-nav-down');
        removeDpadHighlight('btn-hint-direction');
        removeDpadHighlight('btn-hint-target');

        // Remove answer key highlights
        const lowerKey = e.key.toLowerCase();
        const keyToEnglishId = {
            '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
            'r': 'r', 'р': 'r',
            't': 't', 'т': 't',
            'o': 'o', 'о': 'o',
            'p': 'p', 'п': 'p',
            'v': 'v', 'в': 'v',
            'i': 'i', 'и': 'i'
        };
        const engKey = keyToEnglishId[lowerKey];
        if (engKey) {
            const ansBtn = document.getElementById(`btn-ans-${engKey}`);
            if (ansBtn) ansBtn.classList.remove('active');
        }
    });

    function highlightKeyIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    function removeKeyHighlight(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }

    function highlightDpadButton(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    function removeDpadHighlight(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }

    // ==========================================
    // ON-SCREEN D-PAD TOUCH CONTROLS
    // ==========================================
    document.getElementById('btn-nav-left').addEventListener('click', () => {
        if (!isInitialized) return;
        moveCameraYaw(-YAW_STEP);
        playStepClick(800);
    });

    document.getElementById('btn-nav-right').addEventListener('click', () => {
        if (!isInitialized) return;
        moveCameraYaw(YAW_STEP);
        playStepClick(800);
    });

    document.getElementById('btn-nav-up').addEventListener('click', () => {
        if (!isInitialized) return;
        if (currentLesson === 4 || currentLesson === 5 || currentLesson === 6) {
            movePlayer(1);
        } else {
            updateDistance(distance - DISTANCE_STEP, false);
        }
        playStepClick(450);
    });

    document.getElementById('btn-nav-down').addEventListener('click', () => {
        if (!isInitialized) return;
        if (currentLesson === 4 || currentLesson === 5 || currentLesson === 6) {
            movePlayer(-1);
        } else {
            updateDistance(distance + DISTANCE_STEP, false);
        }
        playStepClick(450);
    });

    document.getElementById('btn-hint-direction').addEventListener('click', () => {
        if (!isInitialized) return;
        speakDirectionHint();
    });

    document.getElementById('btn-hint-target').addEventListener('click', () => {
        if (!isInitialized) return;
        speakTargetReminder();
    });

    // ==========================================
    // CONFIG CONTROLS
    // ==========================================
    volumeSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        volumeVal.textContent = `${val}%`;
        synth.setVolume(val / 100);
    });

    speedSlider.addEventListener('input', (e) => {
        const val = e.target.value / 10;
        speedVal.textContent = `${val.toFixed(1)} сек`;
        synth.setScanSpeed(val);
    });

    blindModeToggle.addEventListener('change', (e) => {
        const isBlind = e.target.checked;
        renderer.setBlindMode(isBlind);
        renderer.render(hiddenCanvas);

        if (isBlind) {
            speak("Сляп режим активиран. Екранът е скрит.");
        } else {
            speak("Сляп режим деактивиран.");
        }
    });

    contourToggle.addEventListener('change', (e) => {
        const isContour = e.target.checked;
        renderer.setContourMode(isContour);
        renderer.render(hiddenCanvas);
        
        speak(isContour ? "Режим контурни фигури." : "Режим плътни фигури.");
    });

    // Lesson button click overrides
    document.querySelectorAll('.btn-lesson').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!isInitialized) return;
            const lessonNum = parseInt(btn.getAttribute('data-lesson'));
            if (lessonNum === currentLesson) return;

            if (lessonNum === 1) {
                speak("Преминавате към Урок едно.");
            } else if (lessonNum === 2) {
                speak("Преминавате към Урок две.");
            } else if (lessonNum === 3) {
                speak("Преминавате към Урок три.");
            } else if (lessonNum === 4) {
                speak("Преминавате към Игра Лов на фигури. Намерете и съберете десет фигури.");
            } else if (lessonNum === 5) {
                speak("Преминавате към Обучение в лабиринт. Навигирайте по празните коридори.");
            } else if (lessonNum === 6) {
                speak("Преминавате към Лов в лабиринт. Намерете и съберете десет фигури в лабиринта.");
            }

            selectLesson(lessonNum);
        });
    });

    // Escape menu items click handlers
    document.querySelectorAll('#escape-menu .btn-menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const level = parseInt(btn.getAttribute('data-level'));
            selectLesson(level);
            toggleEscapeMenu(false);
        });
    });

    closeMenuBtn.addEventListener('click', () => {
        toggleEscapeMenu(false);
    });

    // Height config slider listener
    const heightSlider = document.getElementById('height-slider');
    const heightVal = document.getElementById('height-val');
    
    heightSlider.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        heightVal.textContent = `${val.toFixed(2)} м`;
        renderer.setCameraHeight(val);
        renderer.render(hiddenCanvas);
    });

    // Answer button click overrides
    document.querySelectorAll('.btn-answer').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!isInitialized) return;
            const ansCode = btn.getAttribute('data-answer');
            checkAnswer(ansCode);
        });
    });

    // ==========================================
    // SPECTROGRAM WATERFALL RENDERER
    // ==========================================
    function clearSpectrogram() {
        specCtx.fillStyle = '#02040a';
        specCtx.fillRect(0, 0, specCanvas.width, specCanvas.height);
        
        specCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        specCtx.lineWidth = 1;
        specCtx.beginPath();
        specCtx.moveTo(0, specCanvas.height * 0.25);
        specCtx.lineTo(specCanvas.width, specCanvas.height * 0.25);
        specCtx.moveTo(0, specCanvas.height * 0.5);
        specCtx.lineTo(specCanvas.width, specCanvas.height * 0.5);
        specCtx.moveTo(0, specCanvas.height * 0.75);
        specCtx.lineTo(specCanvas.width, specCanvas.height * 0.75);
        specCtx.stroke();
    }

    function drawSpectrogramColumn(col, totalCols) {
        const colW = specCanvas.width / totalCols;
        const x = col * colW;
        const H = specCanvas.height;

        const brightness = synth.getColumnBrightness(hiddenCanvas, col);

        specCtx.fillStyle = '#02040a';
        specCtx.fillRect(x, 0, colW + 1, H);

        const numBands = brightness.length;
        const bandH = H / numBands;

        for (let i = 0; i < numBands; i++) {
            const y = H - (i + 1) * bandH;
            const val = brightness[i];

            if (val > 0.02) {
                const alpha = Math.min(1.0, val * 1.5);
                let color;
                if (val > 0.8) {
                    color = `rgba(255, 255, 255, ${alpha})`;
                } else if (val > 0.4) {
                    color = `rgba(0, 255, 204, ${alpha})`;
                } else {
                    color = `rgba(0, 100, 150, ${alpha})`;
                }

                specCtx.fillStyle = color;
                specCtx.fillRect(x, y, colW + 0.5, bandH + 0.5);
            }
        }

        specCtx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        specCtx.fillRect(x, Math.floor(H * 0.25), 1, 1);
        specCtx.fillRect(x, Math.floor(H * 0.5), 1, 1);
        specCtx.fillRect(x, Math.floor(H * 0.75), 1, 1);

        if (col === totalCols - 1) {
            setTimeout(() => {
                if (synth.currentCol < 2) {
                    clearSpectrogram();
                }
            }, 100);
        }
    }

    clearSpectrogram();

    // Service Worker registration disabled to avoid browser caching issues during testing
    /*
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('ServiceWorker registered successfully:', reg.scope))
                .catch(err => console.log('ServiceWorker registration failed:', err));
        });
    }
    */
});
