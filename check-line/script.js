const grid = document.getElementById("grid");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Create 5x5 grid
const gridArray = [];
for (let i = 0; i < 25; i++) {
    const div = document.createElement("div");
    div.className = "grid-item";
    div.textContent = Math.random() > 0.5 ? "X" : "O"; // Random X or O
    gridArray.push(div.textContent);
    grid.appendChild(div);
}

// Check for matches
function checkMatches() {
    const size = 5;
    const winPatterns = [
        // Horizontal rows
        [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
        // Vertical columns
        [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
        // Diagonals
        [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
    ];

    // Loop through each pattern to check for matches
    winPatterns.forEach(pattern => {
        const firstValue = gridArray[pattern[0]];
        if (pattern.every(index => gridArray[index] === firstValue)) {
            drawLine(pattern);
        }
    });
}

// Draw a line for each matching pattern
function drawLine(pattern) {
    const positions = pattern.map(index => ({
        x: (index % 5) * 100 + 50, // x-coordinate
        y: Math.floor(index / 5) * 100 + 50 // y-coordinate
    }));

    ctx.beginPath();
    ctx.moveTo(positions[0].x, positions[0].y);

    positions.forEach(pos => {
        ctx.lineTo(pos.x, pos.y);
    });

    ctx.strokeStyle = "red";
    ctx.lineWidth = 5;
    ctx.stroke();
}

// Trigger match checking on page load
checkMatches();
