const hh = document.querySelector('.hh');
const mm = document.querySelector('.mm');
const ss = document.querySelector('.ss');

clock = () => {
    let today = new Date();
    let h = (today.getHours() % 12) + today.getMinutes() / 59; // 22 % 12 = 10pm
    let m = today.getMinutes(); // 0 - 59
    let s = today.getSeconds(); // 0 - 59
    if (today.getHours() % 12 < 10) {
        Mh = "0"+today.getHours() % 12;
    }
    if (m < 10) {
        m = "0"+m;
    }
    if (s < 10) {
        s = "0"+s;
    }

    document.querySelector('.hour').innerHTML = Mh;
    document.querySelector('.minute').innerHTML = m;
    document.querySelector('.second').innerHTML = s;

    h *= 30; // 12 * 30 = 360deg
    m *= 6;
    s *= 6; // 60 * 6 = 360deg
    console.log();


    rotation(hh, Math.floor(h));
    rotation(mm, m);
    rotation(ss, s);

    // call every second
    setTimeout(clock, 1000);
}
rotation = (target, val) => {
    console.log(target, val);

    target.style.transform = `rotate(${val}deg)`;
}
window.onload = clock();