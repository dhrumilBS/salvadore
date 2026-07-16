let currentPlayer = 1; // Start with Player 1

document.getElementById('rollDiceButton').addEventListener('click', function () {
    if (currentPlayer === 1) {
        rollDiceForPlayer(1);
    } else if (currentPlayer === 2) {
        rollDiceForPlayer(2);
    }
});

function rollDiceForPlayer(player) {
    // Generate random numbers for the dice
    const dice1 = Math.floor(Math.random() * 6) + 1;
    const dice2 = Math.floor(Math.random() * 6) + 1;

    // Rotate the dice for the respective player
    rotateDice(dice1, dice2, player);

    // Store history and update UI
    updateHistory(dice1, dice2, player);

    // Send the result to PHP to store history
    sendRollToServer(dice1, dice2, player);

    // Switch turns after rolling
    switchTurn();
}

function rotateDice(dice1, dice2, player) {
    const diceElem = player === 1 ? document.getElementById('dice1') : document.getElementById('dice2');
    
    diceElem.classList.add('rotate');

    setTimeout(() => {
        diceElem.classList.remove('rotate');
        
        // Set new number on dice after rotation
        diceElem.textContent = player === 1 ? dice1 : dice2;
    }, 600);
}

function updateHistory(dice1, dice2, player) {
    const historyElem = document.getElementById('history');
    const newHistory = document.createElement('div');
    newHistory.className = 'history-item';
    newHistory.textContent = `Player ${player}: ${player === 1 ? dice1 : dice2}`;
    historyElem.prepend(newHistory);
}

function sendRollToServer(dice1, dice2, player) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'store_roll.php', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.send(`dice1=${dice1}&dice2=${dice2}&player=${player}`);
}

function switchTurn() {
    currentPlayer = currentPlayer === 1 ? 2 : 1; // Switch between player 1 and 2
    document.getElementById('turnIndicator').textContent = `Player ${currentPlayer}'s Turn`;
}
