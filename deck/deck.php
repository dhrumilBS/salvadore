<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Animated Card Deck</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Space+Grotesk:300,regular,500,600,700">
    <link rel="stylesheet" href="./style.css">
</head>

<body>
    <?php

    class Deck
    {
        private array $cards = [];

        public function __construct()
        {
            $suits  = ['diamonds', 'clubs', 'hearts', 'spades'];
            $values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

            foreach ($suits as $suit) {
                foreach ($values as $value) {
                    $this->cards[] = [
                        'suit'  => $suit,
                        'value' => $value,
                        'image' => "./images/{$value}_of_{$suit}.png"
                    ];
                }
            }
        }

        public function shuffle(): void
        {
            shuffle($this->cards);
        }

        public function draw()
        {
            return array_shift($this->cards);
        }

        public function remaining(): int
        {
            return count($this->cards);
        }

        public function getCards(): array
        {
            return $this->cards;
        }
    }

    $deck = new Deck();
    $deck->shuffle();

    $deck = new Deck();
    $deck->shuffle();

    $players = [[], [], [], []];

    for ($i = 0; $i < 5; $i++) {
        foreach ($players as &$player) {
            $player[] = $deck->draw();
        }
    }

    foreach ($players as $player) {
        foreach ($player as $card) {
    ?>
            <!-- <div class="card">
                <div class="card-inner">
                    <div class="card-back">
                        <img src="./images/card-back.svg">
                    </div>

                    <div class="card-front">
                        <img src="<?= $card['image'] ?>">
                    </div>
                </div>
            </div> -->
    <?php
        }
    }
    ?>
</body>

</html>