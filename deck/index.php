<?php

class Card {
    public $suit;
    public $rank;

    public function __construct($suit, $rank) {
        $this->suit = $suit;
        $this->rank = $rank;
    }

    public function __toString() {
        return $this->rank . ' of ' . $this->suit;
    }
}

class Deck {
    public $cards;

    public function __construct() {
        $this->cards = [];
        $suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        $ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

        foreach ($suits as $suit) {
            foreach ($ranks as $rank) {
                $this->cards[] = new Card($suit, $rank);
            }
        }
    }

    public function shuffle() {
        shuffle($this->cards);
    }

    public function deal($numCards) {
        $dealtCards = array_splice($this->cards, 0, $numCards);
        return $dealtCards;
    }
}

// Usage example
$deck = new Deck();
$deck->shuffle();

// Deal and display 5 cards
$hand = $deck->deal(5);
foreach ($hand as $card) {
    echo $card . "\n";
}
?>
