<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Animated Card Deck</title>
<style>
    .card {
        width: 100px;
        height: 150px;
        background: #fff;
        border: 1px solid #000;
        display: inline-block;
        margin: 5px;
        transition: transform 0.5s;
    }

    .card img {
        width: 100%;
        height: 100%;
    }
</style>
</head>
<body>
<div id="deck">
    <?php
    $suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    $values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

    foreach ($suits as $suit) {
        foreach ($values as $value) {
            echo "<div class='card'>";
            echo "<img src='./images/{$value}_of_{$suit}.png' alt='{$value} of {$suit}'>";
            echo "</div>";
        }
    }
    ?>
</div>

<script>
    // Example JavaScript for card animation (flipping)
    const cards = document.querySelectorAll('.card');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            card.style.transform = 'rotateY(180deg)';
            setTimeout(() => {
                card.style.transform = 'rotateY(0deg)';
            }, 1000); // Adjust the time for the animation
        });
    });
</script>
</body>
</html>
