$(document).ready(function () {

    $('#players-form').submit(function (event) {
        event.preventDefault(); // Prevent the form from submitting in the default way

        var formData = $(this).serialize(); // Serialize form data
        console.log(formData);

        $.ajax({
            type: 'POST',
            url: './api/players.php',
            data: formData,
            dataType: 'json',
            success: function (response) {
                // Handle success response 
                console.log((response));
                if (response['success'] == true) {
                    console.log(response);
                    $('#players').html(' ')
                    for (var i = 1; i <= response['player']; i++) {
                        $('#players').append(`<div class="player" id="player${i}">\
                        <h2>Player ${i}</h2>\
                        <div class="hand" id="hand${i}"></div>\
                    </div>`);

                    }

                }
            },
            error: function (xhr, status, error) {
                // Handle error
                console.error('Error:', error);
            }
        });
    });


    var deck = [];
    var players = [];
    const cardOrder = ['8', '9', 'J', 'Q', 'K', 'A', '10']; // 10 highest
    let game = {
        players: [],
        currentTurn: 0,
        tableCards: [],
        leadSuit: null,
        trump: 'Spades',
        teams: {
            teamA: [0, 2],
            teamB: [1, 3]
        },
        scores: {
            teamA: 0,
            teamB: 0
        }
    };

    function createDeck() {
        var dack = 5;
        var suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        var values = ['8', '9', '10', 'J', 'Q', 'K', 'A'];


        for (var d = 0; d < dack; d++) {
            for (var i = 0; i < 4; i++) {
                for (var j = 0; j < values.length; j++) {
                    deck.push({ suit: suits[i], value: values[j] });
                }
            }
        }
    }
    function shuffleDeck() {
        for (var i = deck.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = deck[i];
            deck[i] = deck[j];
            deck[j] = temp;
        }
    }
    function dealCards(player = 4) {
        var numPlayers = player;
        var cardsPerPlayer = 13;

        for (var i = 0; i < numPlayers; i++) {
            players[i] = [];
        }

        for (var j = 0; j < cardsPerPlayer; j++) {
            for (var k = 0; k < numPlayers; k++) {
                players[k].push(deck.pop());
            }
        }

        renderHandsAnimated();
    }
    function renderHandsAnimated() {
        var delay = 0;

        for (let j = 0; j < players[0].length; j++) {
            for (let i = 0; i < players.length; i++) {

                let handId = '#hand' + (i + 1);
                let card = players[i][j];

                let suitSymbol = {
                    Spades: "♠",
                    Hearts: "♥",
                    Diamonds: "♦",
                    Clubs: "♣"
                };

                let cardHtml = `
            <div class="card-container dealing">
                <div class="card-inner">
                    <div class="card front ${card.suit}">
                        <div class="top">
                            <span>${card.value}</span>
                            <span>${suitSymbol[card.suit]}</span>
                        </div>
                        <div class="center">${suitSymbol[card.suit]}</div>
                        <div class="bottom">
                            <span>${card.value}</span>
                            <span>${suitSymbol[card.suit]}</span>
                        </div>
                    </div>
                    <div class="card back"></div>
                </div>
            </div>
            `;

                setTimeout(() => {
                    $(handId).append(cardHtml);

                    // animation trigger
                    $(handId + ' .card-container:last')
                        .removeClass('dealing')
                        .addClass('dealt');

                }, delay);

                delay += 150; // speed of dealing
            }
        }
    }

    $('#start-game').click(function () {
        createDeck();
        shuffleDeck();
        dealCards();
        $("#numPlayers").on("change", function () {
            var player = $(this).val()
            console.log(player);

            dealCards(player);
        })
    });
    function playCard(playerIndex, card) {

        // ❌ Not your turn
        if (playerIndex !== game.currentTurn) return;

        // Set lead suit
        if (game.tableCards.length === 0) {
            game.leadSuit = card.suit;
        }

        game.tableCards.push({
            player: playerIndex,
            card: card
        });

        // Remove card from player hand
        players[playerIndex] = players[playerIndex].filter(c => c !== card);

        // Next turn
        game.currentTurn = (game.currentTurn + 1) % players.length;

        // If 4 cards played → decide winner
        if (game.tableCards.length === 4) {
            setTimeout(resolveRound, 800);
        }
    }


    // Winner

    function getCardValue(value) {
        return cardOrder.indexOf(value);
    }

    function resolveRound() {

        let winning = game.tableCards[0];

        game.tableCards.forEach(play => {

            let current = play.card;
            let best = winning.card;

            // Trump beats everything
            if (current.suit === game.trump && best.suit !== game.trump) {
                winning = play;
            }
            // Same suit comparison
            else if (
                current.suit === best.suit &&
                getCardValue(current.value) > getCardValue(best.value)
            ) {
                winning = play;
            }
        });

        let winner = winning.player;

        // Count 10 cards
        game.tableCards.forEach(p => {
            if (p.card.value === '10') {
                if (game.teams.teamA.includes(winner)) {
                    game.scores.teamA++;
                } else {
                    game.scores.teamB++;
                }
            }
        });

        console.log("Round Winner: Player", winner + 1);

        // Reset
        game.tableCards = [];
        game.currentTurn = winner;
    }

    function checkGameWinner() {
        if (game.scores.teamA >= 5) {
            alert("Team A Wins!");
        } else if (game.scores.teamB >= 5) {
            alert("Team B Wins!");
        }
    }


    function updateTurnUI() {
        $('.player').removeClass('active');
        $('#player' + (game.currentTurn + 1)).addClass('active');
    }





    $(document).on('click', '.card-container', function () {
        $(this).toggleClass('flip');
    });
    $(document).on('click', '.card-container', function () {
        let playerIndex = $(this).closest('.player').index();
        let cardIndex = $(this).index();
        let card = players[playerIndex][cardIndex];
        playCard(playerIndex, card);
        $(this).remove();
    });
    setTimeout(() => {
        $('.card-container').addClass('flip');
    }, delay + 500);
});
