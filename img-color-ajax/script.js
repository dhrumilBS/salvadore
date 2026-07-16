$(document).ready(function () {
    $("#image-preview").hide()
    $("#imageInput").change(function () {
        readURL(this);
    });
    function readURL(input) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();

            reader.onload = function (e) {
                // Update the image preview source
                $('.card-img').attr('src', e.target.result)
                $("#image-preview").show()
            };
            reader.readAsDataURL(input.files[0]);
        }
    }


    $("#image-upload-form").on("submit", function (ev) {
        ev.preventDefault();
        var formData = new FormData(this);
        console.log('formData', formData);

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