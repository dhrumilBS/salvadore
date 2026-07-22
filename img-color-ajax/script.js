$(document).ready(function () {
    $("#image-preview").hide()

    $("#fileUpload").change(function () {
        readURL(this);
    });

    function readURL(input) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();

            reader.onload = function (e) {
                var img = $('.card-img');
                img.attr('src', e.target.result);
                $("#image-preview").show();

                // wait for image to render, then pick its color
                img.off('load').on('load', function () {
                    applyAmbient(this);
                });
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    function applyAmbient(imgEl) {
        var rgb = getAverageRGB(imgEl);
        var color = rgb.r + ',' + rgb.g + ',' + rgb.b;

        // ambient glow around the card
        $('.ambient-card').css({
            'box-shadow': '0 0 40px 5px rgba(' + color + ', 0.8), 0 0 120px 40px rgba(' + color + ', 0.5), 0 0 200px 80px rgba(' + color + ', 0.25)'
        });

        // subtle tint on the page background
        $('body').css('background-color', 'rgba(' + color + ', 0.15)');
    }

    function getAverageRGB(imgEl) {
        var blockSize = 5,
            defaultRGB = { r: 0, g: 0, b: 0 },
            canvas = document.createElement('canvas'),
            context = canvas.getContext && canvas.getContext('2d'),
            data, width, height,
            i = -4,
            length,
            rgb = { r: 0, g: 0, b: 0 },
            count = 0;

        if (!context) {
            return defaultRGB;
        }

        height = canvas.height = imgEl.naturalHeight || imgEl.offsetHeight || imgEl.height;
        width = canvas.width = imgEl.naturalWidth || imgEl.offsetWidth || imgEl.width;

        context.drawImage(imgEl, 0, 0);

        try {
            data = context.getImageData(0, 0, width, height);
        } catch (e) {
            return defaultRGB;
        }

        length = data.data.length;

        while ((i += blockSize * 4) < length) {
            ++count;
            rgb.r += data.data[i];
            rgb.g += data.data[i + 1];
            rgb.b += data.data[i + 2];
        }

        rgb.r = ~~(rgb.r / count);
        rgb.g = ~~(rgb.g / count);
        rgb.b = ~~(rgb.b / count);

        return rgb;
    }

    $("#image-upload-form").on("submit", function (ev) {
        ev.preventDefault();
        var formData = new FormData(this);

        $.ajax({
            url: "submit.php",
            type: "POST",
            data: formData,
            dataType: 'json',
            success: function (msg) {
                console.log(msg);
                console.log('status: ', msg.status);
                console.log('data: ', msg.data);
            },
            cache: false,
            contentType: false,
            processData: false
        });
    });
});
