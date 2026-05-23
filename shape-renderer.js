/**
 * ShapeRenderer - Handles rendering of high-contrast 3D-like shapes
 * on a black canvas and handles camera rotation (yaw angle) and player movement.
 */
class ShapeRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Dimensions
        this.width = this.canvas.width;
        this.height = this.canvas.height;

        // Camera yaw angle in degrees (-180 to 180)
        this.cameraYaw = 0;
        this.fov = 70; // Horizontal Field of View in degrees

        // Player coordinates in world space (meters)
        this.playerX = 0;
        this.playerY = 0;

        // Base size as percentage of canvas width
        this.shapeSizePercent = 0.21; 

        // List of shapes in the room
        this.shapes = [];

        // Render configuration
        this.isBlindMode = false;
        this.isContourMode = true; // Default to contour/outline rendering

        // Labyrinth configuration (Lesson 5)
        this.mazeGrid = null;
        this.cameraHeight = 1.65; // Default camera height in meters
    }

    setShapes(shapes) {
        this.shapes = shapes;
    }

    setMazeGrid(grid) {
        this.mazeGrid = grid;
    }

    projectPoint(x, y) {
        const dx = x - this.playerX;
        const dy = y - this.playerY;
        
        // Rotate by cameraYaw (cameraYaw is in degrees, positive is clockwise)
        const radYaw = (this.cameraYaw * Math.PI) / 180;
        
        // Transform to camera coordinates (cy is forward, cx is right)
        const cx = dx * Math.cos(radYaw) - dy * Math.sin(radYaw);
        const cy = dx * Math.sin(radYaw) + dy * Math.cos(radYaw);
        
        return { cx, cy };
    }

    drawPerspectiveLine(x1, y1, x2, y2, ctx, W, H, drawVisualEnhancements, height = 0.0) {
        let p1 = this.projectPoint(x1, y1);
        let p2 = this.projectPoint(x2, y2);
        
        // Clip to cy >= 0.1
        if (p1.cy < 0.1 && p2.cy < 0.1) return;
        
        if (p1.cy < 0.1) {
            const t = (0.1 - p1.cy) / (p2.cy - p1.cy);
            p1.cx = p1.cx + t * (p2.cx - p1.cx);
            p1.cy = 0.1;
        }
        if (p2.cy < 0.1) {
            const t = (0.1 - p2.cy) / (p1.cy - p2.cy);
            p2.cx = p2.cx + t * (p1.cx - p2.cx);
            p2.cy = 0.1;
        }
        
        // Now project to screen coordinates
        const cameraHeight = this.cameraHeight || 1.65;
        const relativeHeight = cameraHeight - height;
        const fovScale = W / 1.4; // horizontal scale factor
        
        const screenX1 = W / 2 + (p1.cx / p1.cy) * fovScale;
        const screenY1 = H / 2 + (relativeHeight / p1.cy) * (H / 1.4);
        
        const screenX2 = W / 2 + (p2.cx / p2.cy) * fovScale;
        const screenY2 = H / 2 + (relativeHeight / p2.cy) * (H / 1.4);
        
        // Calculate average distance to segment for brightness attenuation
        const avgDist = (p1.cy + p2.cy) / 2;
        if (avgDist > 4.0) return; // don't draw very far walls
        
        const maxDist = 4.0;
        const minDist = 0.3;
        const brightnessScale = Math.max(0.12, Math.min(1.0, 1.0 - (avgDist - minDist) / (maxDist - minDist) * 0.85));
        const colorVal = Math.floor(brightnessScale * 255);
        
        let colorStr;
        if (drawVisualEnhancements) {
            colorStr = `rgba(0, 150, 255, ${brightnessScale})`; // Neon blue floor-wall boundary line
        } else {
            colorStr = `rgb(${colorVal}, ${colorVal}, ${colorVal})`; // Grayscale for audio scanner
        }
        
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = drawVisualEnhancements ? 3 : 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(screenX1, screenY1);
        ctx.lineTo(screenX2, screenY2);
        ctx.stroke();
    }

    drawPerspectiveVerticalLine(x, y, ctx, W, H, drawVisualEnhancements) {
        let p = this.projectPoint(x, y);
        if (p.cy < 0.1) return; // behind camera or too close
        if (p.cy > 4.0) return; // too far
        
        const cameraHeight = this.cameraHeight || 1.65;
        const fovScale = W / 1.4;
        
        const screenX = W / 2 + (p.cx / p.cy) * fovScale;
        
        // Floor intersection (bottom)
        const screenY_floor = H / 2 + (cameraHeight / p.cy) * (H / 1.4);
        // Ceiling intersection (top, ceiling is at 2.5m)
        const screenY_ceiling = H / 2 + ((cameraHeight - 2.5) / p.cy) * (H / 1.4);
        
        // Brightness based on distance
        const maxDist = 4.0;
        const minDist = 0.3;
        const brightnessScale = Math.max(0.12, Math.min(1.0, 1.0 - (p.cy - minDist) / (maxDist - minDist) * 0.85));
        const colorVal = Math.floor(brightnessScale * 255);
        
        let colorStr;
        if (drawVisualEnhancements) {
            colorStr = `rgba(0, 200, 255, ${brightnessScale})`; // Cyan/Blue vertical corner
        } else {
            colorStr = `rgb(${colorVal}, ${colorVal}, ${colorVal})`; // Grayscale for audio scanner
        }
        
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = drawVisualEnhancements ? 3 : 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(screenX, screenY_floor);
        ctx.lineTo(screenX, screenY_ceiling);
        ctx.stroke();
    }

    setCameraHeight(height) {
        this.cameraHeight = height;
    }

    isPointVisible(px, py) {
        if (!this.mazeGrid) return true;
        const startX = this.playerX;
        const startY = this.playerY;
        
        const dx = px - startX;
        const dy = py - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.15) return true; // always see your own cell
        
        // Shift target point slightly towards the player to prevent wall cell rounding collision
        const epsilon = 0.08;
        const targetX = dist > epsilon ? px - (epsilon * dx / dist) : px;
        const targetY = dist > epsilon ? py - (epsilon * dy / dist) : py;
        
        const tdx = targetX - startX;
        const tdy = targetY - startY;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        
        // Raycast from player to target point
        const stepSize = 0.15; // check every 15cm
        const numSteps = Math.floor(tdist / stepSize);
        
        for (let i = 1; i <= numSteps; i++) {
            const t = (i * stepSize) / tdist;
            const tx = startX + t * tdx;
            const ty = startY + t * tdy;
            
            const gx = Math.round(tx + 3.5);
            const gy = Math.round(ty + 3.5);
            
            if (gx >= 0 && gx < this.mazeGrid[0].length && gy >= 0 && gy < this.mazeGrid.length) {
                if (this.mazeGrid[gy][gx] === 1) {
                    return false; // blocked by wall cell
                }
            }
        }
        return true;
    }

    drawOccludedPerspectiveLine(x1, y1, x2, y2, ctx, W, H, drawVisualEnhancements, height = 0.0) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Number of subdivisions based on segment length (approx. 1 segment per 0.2m)
        const N = Math.max(1, Math.ceil(dist / 0.2));
        
        for (let i = 0; i < N; i++) {
            const tStart = i / N;
            const tEnd = (i + 1) / N;
            
            const sx1 = x1 + tStart * dx;
            const sy1 = y1 + tStart * dy;
            const sx2 = x1 + tEnd * dx;
            const sy2 = y1 + tEnd * dy;
            
            // Check if center of sub-segment is visible
            const cx = (sx1 + sx2) / 2;
            const cy = (sy1 + sy2) / 2;
            
            if (this.isPointVisible(cx, cy)) {
                this.drawPerspectiveLine(sx1, sy1, sx2, sy2, ctx, W, H, drawVisualEnhancements, height);
            }
        }
    }

    setPlayerPosition(x, y) {
        this.playerX = x;
        this.playerY = y;
    }

    setCameraYaw(yaw) {
        // Normalize yaw between -180 and 180 degrees
        this.cameraYaw = ((yaw + 180) % 360 + 360) % 360 - 180;
    }

    setBlindMode(isBlind) {
        this.isBlindMode = isBlind;
    }

    setContourMode(isContour) {
        this.isContourMode = isContour;
    }

    // Deprecated but kept for backwards compatibility
    setShape(type) {
        // Single shape fallback
        this.shapes = [{
            type: type,
            x: 0,
            y: 1.0,
            isContourMode: this.isContourMode,
            isCollected: false,
            isTarget: true
        }];
    }

    setDistance(dist) {
        // Single shape fallback
        if (this.shapes.length > 0) {
            this.shapes[0].y = dist;
        }
    }

    /**
     * Render the scene.
     * In Blind Mode, the canvas is completely black for the user, but we will
     * render the high-contrast shapes to a hidden canvas so the VoiceSynth can scan it!
     * @param {HTMLCanvasElement} hiddenCanvas Canvas used by VoiceSynth for image scanning.
     */
    render(hiddenCanvas) {
        // We always render to the hidden canvas first (pure black/white for scanner)
        this.drawScene(hiddenCanvas, false);

        // Then we draw to the visible canvas
        if (this.isBlindMode) {
            // Draw pure black to visible canvas
            const ctx = this.canvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, this.width, this.height);

            // Draw a subtle "Blind Mode Active" or eye-closed icon in center
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.font = '24px Outfit, Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('СЛЯП РЕЖИМ (АКТИВЕН АУДИО СКЕНЕР)', this.width / 2, this.height / 2);
            ctx.font = '14px Outfit, sans-serif';
            ctx.fillText('Разчитайте само на слуховия профил', this.width / 2, this.height / 2 + 35);
        } else {
            // Draw the actual visual scene to the visible canvas
            this.drawScene(this.canvas, true);
        }
    }

    /**
     * Draw the geometric shapes on a black background.
     * @param {HTMLCanvasElement} targetCanvas Canvas to draw onto.
     * @param {boolean} drawVisualEnhancements If true, add grids, lights, and labels for sighted users.
     */
    drawScene(targetCanvas, drawVisualEnhancements) {
        const ctx = targetCanvas.getContext('2d');
        const W = targetCanvas.width;
        const H = targetCanvas.height;

        // Clear canvas with absolute black
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);

        if (drawVisualEnhancements && !this.mazeGrid) {
            // Draw a futuristic room grid (spatial guidelines)
            ctx.strokeStyle = '#112233';
            ctx.lineWidth = 1;
            const horizonY = H / 2;
            
            // Draw vertical grid lines spreading from horizon center based on camera yaw
            const centerX = W / 2 - (this.cameraYaw * (W / this.fov));
            
            ctx.beginPath();
            for (let i = -10; i <= 10; i++) {
                const x = centerX + i * 150;
                ctx.moveTo(x, H);
                ctx.lineTo(W / 2 + (x - W / 2) * 0.1, horizonY);
            }
            ctx.stroke();

            // Horizon line
            ctx.strokeStyle = '#0a3355';
            ctx.beginPath();
            ctx.moveTo(0, horizonY);
            ctx.lineTo(W, horizonY);
            ctx.stroke();
        }

        // Labyrinth Walls perspective lines rendering (Lessons 5 and 6)
        if (this.mazeGrid) {
            const sizeX = this.mazeGrid[0].length;
            const sizeY = this.mazeGrid.length;
            const inset = 0.0; // Clean, natural-width corridors
            
            // Loop through all grid cells and draw boundaries of walkable corridors
            for (let gy = 0; gy < sizeY; gy++) {
                for (let gx = 0; gx < sizeX; gx++) {
                    if (this.mazeGrid[gy][gx] === 0) {
                        const xMin = -3.5 + gx - 0.5;
                        const xMax = -3.5 + gx + 0.5;
                        const yMin = -3.5 + gy - 0.5;
                        const yMax = -3.5 + gy + 0.5;
                        
                        const hasWest = (gx === 0 || this.mazeGrid[gy][gx - 1] === 1);
                        const hasEast = (gx === sizeX - 1 || this.mazeGrid[gy][gx + 1] === 1);
                        const hasSouth = (gy === 0 || this.mazeGrid[gy - 1][gx] === 1);
                        const hasNorth = (gy === sizeY - 1 || this.mazeGrid[gy + 1][gx] === 1);
                        
                        // West boundary: draw visible sub-segments (floor & ceiling)
                        if (hasWest) {
                            this.drawOccludedPerspectiveLine(xMin + inset, yMin + inset, xMin + inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 0.0);
                            this.drawOccludedPerspectiveLine(xMin + inset, yMin + inset, xMin + inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 2.5);
                        }
                        // East boundary
                        if (hasEast) {
                            this.drawOccludedPerspectiveLine(xMax - inset, yMin + inset, xMax - inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 0.0);
                            this.drawOccludedPerspectiveLine(xMax - inset, yMin + inset, xMax - inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 2.5);
                        }
                        // South boundary
                        if (hasSouth) {
                            this.drawOccludedPerspectiveLine(xMin + inset, yMin + inset, xMax - inset, yMin + inset, ctx, W, H, drawVisualEnhancements, 0.0);
                            this.drawOccludedPerspectiveLine(xMin + inset, yMin + inset, xMax - inset, yMin + inset, ctx, W, H, drawVisualEnhancements, 2.5);
                        }
                        // North boundary
                        if (hasNorth) {
                            this.drawOccludedPerspectiveLine(xMin + inset, yMax - inset, xMax - inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 0.0);
                            this.drawOccludedPerspectiveLine(xMin + inset, yMax - inset, xMax - inset, yMax - inset, ctx, W, H, drawVisualEnhancements, 2.5);
                        }
                    }
                }
            }

            // Draw vertical columns only at actual turns/corners (not straight walls)
            const drawnCorners = new Set();
            const isWall = (x, y) => {
                if (x < 0 || x >= sizeX || y < 0 || y >= sizeY) return true;
                return this.mazeGrid[y][x] === 1;
            };

            const isCornerIntersection = (cx, cy) => {
                const gx_right = Math.round(cx + 3.5);
                const gy_top = Math.round(cy + 3.5);
                const gx_left = gx_right - 1;
                const gy_bottom = gy_top - 1;
                
                const tr = isWall(gx_right, gy_top);
                const tl = isWall(gx_left, gy_top);
                const br = isWall(gx_right, gy_bottom);
                const bl = isWall(gx_left, gy_bottom);
                
                const wallCount = (tr ? 1 : 0) + (tl ? 1 : 0) + (br ? 1 : 0) + (bl ? 1 : 0);
                if (wallCount === 0 || wallCount === 4) return false;
                
                // Flat vertical wall: TL & BL are walls, TR & BR are walkable (or vice versa)
                if (tl && bl && !tr && !br) return false;
                if (!tl && !bl && tr && br) return false;
                
                // Flat horizontal wall: TL & TR are walls, BL & BR are walkable (or vice versa)
                if (tl && tr && !bl && !br) return false;
                if (!tl && !tr && bl && br) return false;
                
                return true;
            };

            for (let gy = 0; gy < sizeY; gy++) {
                for (let gx = 0; gx < sizeX; gx++) {
                    if (this.mazeGrid[gy][gx] === 0) {
                        const xMin = -3.5 + gx - 0.5;
                        const xMax = -3.5 + gx + 0.5;
                        const yMin = -3.5 + gy - 0.5;
                        const yMax = -3.5 + gy + 0.5;

                        const corners = [
                            { cx: xMin, cy: yMin },
                            { cx: xMin, cy: yMax },
                            { cx: xMax, cy: yMin },
                            { cx: xMax, cy: yMax }
                        ];

                        for (let corner of corners) {
                            const key = `${corner.cx.toFixed(2)},${corner.cy.toFixed(2)}`;
                            if (!drawnCorners.has(key)) {
                                if (isCornerIntersection(corner.cx, corner.cy)) {
                                    drawnCorners.add(key);
                                    if (this.isPointVisible(corner.cx, corner.cy)) {
                                        this.drawPerspectiveVerticalLine(corner.cx, corner.cy, ctx, W, H, drawVisualEnhancements);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!this.shapes || this.shapes.length === 0) return;

        // Loop through all shapes and draw them if not collected
        this.shapes.forEach(shape => {
            if (shape.isCollected) return;

            // Calculate relative position to player
            const dx = shape.x - this.playerX;
            const dy = shape.y - this.playerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Avoid division by zero
            if (dist < 0.1) return;

            // Calculate angle relative to camera
            let angle = Math.atan2(dx, dy) * 180 / Math.PI;
            let diffYaw = angle - this.cameraYaw;
            diffYaw = ((diffYaw + 180) % 360 + 360) % 360 - 180;

            const halfFov = this.fov / 2;
            if (Math.abs(diffYaw) > halfFov + 20) {
                // If drawVisualEnhancements is true, draw off-screen indicator arrows in HUD if target
                if (drawVisualEnhancements && shape.isTarget) {
                    ctx.fillStyle = '#ff00ff';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    if (diffYaw > 0) {
                        ctx.fillText('→', W - 30, H / 2);
                    } else {
                        ctx.fillText('←', 30, H / 2);
                    }
                }
                return;
            }

            // Screen X mapping
            const xOffset = (diffYaw / halfFov) * (W / 2);
            const screenX = W / 2 + xOffset;
            const screenY = H / 2;

            const radYaw = (diffYaw * Math.PI) / 180;
            const perspectiveScale = Math.cos(radYaw); 
            
            // Size based on distance
            const size = (W * this.shapeSizePercent * perspectiveScale) / dist;

            // Line width based on distance
            const baseLineWidth = drawVisualEnhancements ? (W * 0.0125) : 3;
            const currentLineWidth = drawVisualEnhancements 
                ? Math.max(2, Math.min(12, baseLineWidth / dist))
                : Math.max(2, Math.min(6, baseLineWidth / dist));

            // Calculate brightness based on distance (Closer = brighter, Max at 0.4m, Min at 3.0m)
            const maxDist = 3.0;
            const minDist = 0.4;
            const brightnessScale = Math.max(0.12, Math.min(1.0, 1.0 - (dist - minDist) / (maxDist - minDist) * 0.85));
            const colorVal = Math.floor(brightnessScale * 255);

            let colorStr;
            if (drawVisualEnhancements) {
                // Sighted users see neon colors
                if (shape.isTarget) {
                    colorStr = `rgb(255, ${Math.floor(colorVal * 0.2)}, ${colorVal})`; // Neon Magenta
                } else {
                    colorStr = `rgb(${Math.floor(colorVal * 0.1)}, ${colorVal}, ${Math.floor(colorVal * 0.8)})`; // Neon Teal
                }
            } else {
                // Audio scanner reads pure grayscale (white on black)
                colorStr = `rgb(${colorVal}, ${colorVal}, ${colorVal})`;
            }

            ctx.fillStyle = colorStr;
            ctx.strokeStyle = colorStr;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (drawVisualEnhancements) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = shape.isTarget ? '#ff00ff' : '#00ffcc';
            } else {
                ctx.shadowBlur = 0;
            }

            // Draw shape path
            ctx.beginPath();
            switch (shape.type) {
                case 'square':
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
                    } else {
                        ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
                    }
                    break;

                case 'triangle':
                    ctx.moveTo(screenX, screenY - size / 2);
                    ctx.lineTo(screenX + size / 2, screenY + size / 2);
                    ctx.lineTo(screenX - size / 2, screenY + size / 2);
                    ctx.closePath();
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.stroke();
                    } else {
                        ctx.fill();
                    }
                    break;

                case 'circle':
                    ctx.arc(screenX, screenY, size / 2, 0, 2 * Math.PI);
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.stroke();
                    } else {
                        ctx.fill();
                    }
                    break;

                case 'horizontal_line':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX - size * 0.7, screenY);
                    ctx.lineTo(screenX + size * 0.7, screenY);
                    ctx.stroke();
                    break;

                case 'vertical_line':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX, screenY - size * 0.7);
                    ctx.lineTo(screenX, screenY + size * 0.7);
                    ctx.stroke();
                    break;

                case 'diagonal_up_45':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX - size / 2, screenY + size / 2);
                    ctx.lineTo(screenX + size / 2, screenY - size / 2);
                    ctx.stroke();
                    break;

                case 'diagonal_down_45':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX - size / 2, screenY - size / 2);
                    ctx.lineTo(screenX + size / 2, screenY + size / 2);
                    ctx.stroke();
                    break;

                case 'diagonal_up_25':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX - size / 2, screenY + size * 0.23);
                    ctx.lineTo(screenX + size / 2, screenY - size * 0.23);
                    ctx.stroke();
                    break;

                case 'diagonal_down_25':
                    ctx.lineWidth = currentLineWidth;
                    ctx.moveTo(screenX - size / 2, screenY - size * 0.23);
                    ctx.lineTo(screenX + size / 2, screenY + size * 0.23);
                    ctx.stroke();
                    break;

                case 'rectangle_horizontal':
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.strokeRect(screenX - size / 2, screenY - size * 0.3, size, size * 0.6);
                    } else {
                        ctx.fillRect(screenX - size / 2, screenY - size * 0.3, size, size * 0.6);
                    }
                    break;

                case 'rectangle_vertical':
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.strokeRect(screenX - size * 0.3, screenY - size / 2, size * 0.6, size);
                    } else {
                        ctx.fillRect(screenX - size * 0.3, screenY - size / 2, size * 0.6, size);
                    }
                    break;

                case 'rhombus':
                    ctx.moveTo(screenX, screenY - size / 2);
                    ctx.lineTo(screenX + size / 2, screenY);
                    ctx.lineTo(screenX, screenY + size / 2);
                    ctx.lineTo(screenX - size / 2, screenY);
                    ctx.closePath();
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.stroke();
                    } else {
                        ctx.fill();
                    }
                    break;

                case 'inverted_triangle':
                    ctx.moveTo(screenX - size / 2, screenY - size / 2);
                    ctx.lineTo(screenX + size / 2, screenY - size / 2);
                    ctx.lineTo(screenX, screenY + size / 2);
                    ctx.closePath();
                    if (shape.isContourMode) {
                        ctx.lineWidth = currentLineWidth;
                        ctx.stroke();
                    } else {
                        ctx.fill();
                    }
                    break;
            }

            ctx.shadowBlur = 0;

            // Display shape label for visual debugging
            if (drawVisualEnhancements) {
                ctx.fillStyle = shape.isTarget ? '#ff00ff' : '#00ffcc';
                ctx.font = '11px Outfit, sans-serif';
                ctx.textAlign = 'center';
                
                const shapeToNameBG = {
                    'square': 'Квадрат',
                    'triangle': 'Триъгълник',
                    'circle': 'Кръг',
                    'horizontal_line': 'Хор. линия',
                    'vertical_line': 'Верт. линия',
                    'diagonal_up_45': 'Накл. десен нагоре 45°',
                    'diagonal_down_45': 'Накл. ляв нагоре 45°',
                    'diagonal_up_25': 'Накл. десен нагоре 25°',
                    'diagonal_down_25': 'Накл. ляв нагоре 25°',
                    'rectangle_horizontal': 'Легнал правоъгълник',
                    'rectangle_vertical': 'Изправен правоъгълник',
                    'rhombus': 'Ромб',
                    'inverted_triangle': 'Обърнат триъгълник'
                };
                
                const name = (shape.isContourMode ? 'Контур ' : 'Плътен ') + shapeToNameBG[shape.type];
                ctx.fillText(`${name} (${dist.toFixed(1)}м)`, screenX, screenY - size / 2 - 10);
            }
        });

        // Draw HUD for sighted user
        if (drawVisualEnhancements) {
            ctx.fillStyle = 'rgba(0, 255, 204, 0.7)';
            ctx.font = '12px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Камера: ${Math.round(this.cameraYaw)}° | Позиция: (${this.playerX.toFixed(1)}м, ${this.playerY.toFixed(1)}м)`, W / 2, H - 20);
        }
    }
}
