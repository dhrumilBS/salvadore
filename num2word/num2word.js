function numberToWords(num) {
    if (num === 0) return "zero";
    let belowTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    let thousands = ["", "Thousand", "Lack", "Crore", "Arab", "Kharab", "Niyut", "Padma", "Shankh", "Vardhaman"];
    function helper(n) {
        log.n = n;
        if (n === 0) return "";
        else if (n < 20) return belowTwenty[n] + " ";
        else if (n < 100) return tens[Math.floor(n / 10)] + " " + helper(n % 10);
        else if (n < 1000) return belowTwenty[Math.floor(n / 100)] + " hundred " + helper(n % 100);
    }

    let word = "";
    let i = 0;
    while (num > 0) {
        if (num % 1000 !== 0) {
            word = helper(num % 1000) + thousands[i] + " " + word;
        }
        num = Math.floor(num / 1000);
        i++;
    }
    return word.trim();
}


document.getElementById('numberInput').addEventListener('input', function () {
    const number = this.value;
    if (number === '' || isNaN(number)) {
        document.getElementById('wordResult').style.display = 'none';
        document.getElementById('logBox').style.display = 'none';
    } else {
        const words = numberToWords(Number(number));
        document.getElementById('wordResult').innerHTML = `<strong>In Words:</strong> ${words}`;
        document.getElementById('wordResult').style.display = 'block';
        document.getElementById('logBox').innerHTML = `<strong>Debug Log:</strong><br>Converted ${number} to "${words}"`;
        document.getElementById('logBox').style.display = 'block';
    }
})