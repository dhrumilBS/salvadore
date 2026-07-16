// Mock data for Bingo cards
let player1Board = [];
let player2Board = [];
let usedBalls = new Set();

// Function to generate a bingo card
function generateCard() {
    const card = [];
    const usedNumbers = new Set();

    for (let i = 0; i < 5; i++) {
        const row = [];
        for (let j = 0; j < 5; j++) {
            let number;
            do {
                number = Math.floor(Math.random() * 25) + 1;
            } while (usedNumbers.has(number));
            usedNumbers.add(number);
            row.push(number);
        }
        card.push(row);
    }
    return card;
}

// Function to draw the Bingo board for each player
function drawBoard(board, tableId) {
    const table = document.getElementById(tableId);
    table.innerHTML = '';
    for (const row of board) {
        const tr = document.createElement('tr');
        for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
}

// Function to generate and render Bingo boards
function initGame() {
    player1Board = generateCard();
    player2Board = generateCard();

    drawBoard(player1Board, 'player1-board');
    drawBoard(player2Board, 'player2-board');
}

// Function to draw a random Bingo ball
function drawBall() {
    if (usedBalls.size >= 25) {
        document.getElementById('winner-message').textContent = "All balls drawn. It's a tie!";
        return;
    }

    let ball;
    do {
        ball = Math.floor(Math.random() * 25) + 1;
    } while (usedBalls.has(ball));

    usedBalls.add(ball);
    document.getElementById('current-ball').textContent = ball;

    markBoards(ball);
}

// Function to mark the drawn ball on both boards
function markBoards(ball) {
    markBoard(player1Board, ball, 'player1-board');
    markBoard(player2Board, ball, 'player2-board');

    if (checkBingo(player1Board)) {
        document.getElementById('winner-message').textContent = "Player 1 Wins!";
    } else if (checkBingo(player2Board)) {
        document.getElementById('winner-message').textContent = "Player 2 Wins!";
    }
}

// Function to mark a board if the ball is present
function markBoard(board, ball, tableId) {
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            if (board[i][j] === ball) {
                board[i][j] = 'X';
            }
        }
    }
    drawBoard(board, tableId);
}

// Function to check if a board has a Bingo
function checkBingo(board) {
    // Check rows, columns, and diagonals
    const rows = board;
    const cols = rows[0].map((_, i) => rows.map(row => row[i]));
    const diags = [
        rows.map((row, i) => row[i]),
        rows.map((row, i) => row[4 - i])
    ];


    return [...rows, ...cols, ...diags].some(line => line.every(cell => cell === 'X'));
}

// Initialize the game on page load
window.onload = initGame;

// Add event listener to the draw button
document.getElementById('draw-ball').addEventListener('click', drawBall);
