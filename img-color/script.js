$(document).ready(function () {
    $("#image-preview").hide()
    $("#fileUpload").change(function () {
        readURL(this);
        setTimeout(() => {
            var rgb = getAverageRGB(document.getElementById('i'));
            document.body.style.backgroundColor = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
        }, 500);

    });
    function readURL(input) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();

            reader.onload = function (e) {
                $('.card-img').attr('src', e.target.result)
                $("#image-preview").show()
                console.log('height is', $('.card-img').innerHeight());

            };
            reader.readAsDataURL(input.files[0]);
        }
    }


    function getAverageRGB(imgEl) {

        var blockSize = 5,
            defaultRGB = {
                r: 0,
                g: 0,
                b: 0
            },
            canvas = document.createElement('canvas'),
            context = canvas.getContext && canvas.getContext('2d'),
            data, width, height,
            i = -4,
            length,
            rgb = {
                r: 0,
                g: 0,
                b: 0
            },
            count = 0;
        if (!context) {
            return defaultRGB;
        }
        height = canvas.height = imgEl.naturalHeight || imgEl.offsetHeight || imgEl.height;
        width = canvas.width = imgEl.naturalWidth || imgEl.offsetWidth || imgEl.width;

        imgEl.closest('div').append(canvas)
        context.drawImage(imgEl, 0, 0);


        try {
            data = context.getImageData(0, 0, width, height);
            console.log(data);

        } catch (e) {
            console.log(e);
            return defaultRGB;
        }

        length = data.data.length;
        console.log('length', length);

        while ((i += blockSize * 4) < length) {

            ++count;

            rgb.r += data.data[i];
            rgb.g += data.data[i + 1];
            rgb.b += data.data[i + 2];
        }

        // ~~ used to floor values
        rgb.r = ~~(rgb.r / count);
        rgb.g = ~~(rgb.g / count);
        rgb.b = ~~(rgb.b / count);


        return rgb;

    }


});
document.addEventListener("DOMContentLoaded", function () {
    function Init() {
        console.log("Upload Initialized");

        var fileSelect = document.getElementById("file-upload"),
            fileDrag = document.getElementById("file-drag");

        fileSelect.addEventListener("change", fileSelectHandler, false);

        var xhr = new XMLHttpRequest();
        if (xhr.upload) {
            fileDrag.addEventListener("dragover", fileDragHover, false);
            fileDrag.addEventListener("dragleave", fileDragHover, false);
            fileDrag.addEventListener("drop", fileSelectHandler, false);
        }
    }

    function fileDragHover(e) {
        e.stopPropagation();
        e.preventDefault();
        var fileDrag = document.getElementById("file-drag");
        fileDrag.className = e.type === "dragover" ? "hover" : "modal-body file-upload";
    }

    function fileSelectHandler(e) {
        e.preventDefault();
        e.stopPropagation();

        var files = e.target.files || e.dataTransfer.files;
        fileDragHover(e);

        for (var i = 0; i < files.length; i++) {
            parseFile(files[i]);
            uploadFile(files[i]);
        }
    }

    function output(msg) {
        var m = document.getElementById("messages");
        m.innerHTML = msg;
    }

    function parseFile(file) {
        console.log("File Selected:", file.name);
        output(`<strong>${encodeURI(file.name)}</strong>`);

        var imageName = file.name;
        var isGood = /\.(gif|jpg|jpeg|png)$/i.test(imageName);

        if (isGood) {
            document.getElementById("start").classList.add("hidden");
            document.getElementById("response").classList.remove("hidden");
            document.getElementById("notimage").classList.add("hidden");

            var fileImage = document.getElementById("file-image");
            fileImage.classList.remove("hidden");
            fileImage.src = URL.createObjectURL(file);
        } else {
            document.getElementById("file-image").classList.add("hidden");
            document.getElementById("notimage").classList.remove("hidden");
            document.getElementById("start").classList.remove("hidden");
            document.getElementById("response").classList.add("hidden");
            document.getElementById("file-upload-form").reset();
        }
    }

    function setProgressMaxValue(e) {
        var pBar = document.getElementById("file-progress");
        if (e.lengthComputable) {
            pBar.max = e.total;
        }
    }

    function updateFileProgress(e) {
        var pBar = document.getElementById("file-progress");
        if (e.lengthComputable) {
            pBar.value = e.loaded;
        }
    }

    function uploadFile(file) {
        var xhr = new XMLHttpRequest(),
            pBar = document.getElementById("file-progress"),
            fileSizeLimit = 5; // MB

        if (file.size <= fileSizeLimit * 1024 * 1024) {
            pBar.style.display = "inline";
            xhr.upload.addEventListener("loadstart", setProgressMaxValue, false);
            xhr.upload.addEventListener("progress", updateFileProgress, false);

            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        output("Upload successful!");
                    } else {
                        output("Upload failed.");
                    }
                }
            };

            var formData = new FormData();
            formData.append("file", file);

            xhr.open("POST", document.getElementById("file-upload-form").action, true);
            xhr.send(formData);
        } else {
            output(`Please upload a smaller file (< ${fileSizeLimit} MB).`);
        }
    }

    if (window.File && window.FileList && window.FileReader) {
        Init();
    } else {
        document.getElementById("file-drag").style.display = "none";
    }
});
