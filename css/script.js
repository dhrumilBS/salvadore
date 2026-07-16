$(document).ready(function () {
    $("#createFolderForm").submit(function (e) {
        e.preventDefault();

        const formData = $(this).serialize();


        $.ajax({
            type: 'POST',
            url: 'process_selection.php',
            data: formData,
            dataType: 'json',
            success: function (response) {
                if (response.status == 'success') {

                    let newFolder = $("<div class='large-4 columns'></div>")
                        .attr("data-dirname", $("input[name='folderName']").val())
                        .html(`<h1 class="folder dir_item"> <a href="./${$("input[name='folderName']").val()}" target="_blank"> 📁 ${$("input[name='folderName']").val()} </a></h1>`);

                    $(".dir_list .row").prepend(newFolder);
                    $("#createFolderForm")[0].reset(); // Reset the form
                } else {
                    toastr.error("Error: " + response.message);
                }
            },
            error: function () {
                toastr.error("Error in the AJAX request.");
            }
        });
    });
});
document.getElementById("deleteFolder").addEventListener("submit", function (e) {
    e.preventDefault();

    $.ajax({
        type: 'POST',
        url: 'deleteFolder.php',
        data: $(this).serialize(),
        dataType: 'json',
        beforeSend: function () {
            $("#responseMessage").html("<p style='color: blue;'>Processing...</p>");
        },
        success: function (response) {
            console.log(response);

            if (response.status) {
                let successMsg = "<p style='color: green;'>Folders deleted successfully:</p><ul>";
                response.results.forEach(folder => {
                    successMsg += `<li>${folder.message}</li>`;
                });
                successMsg += "</ul>";
                $("#responseMessage").html(successMsg);
                setTimeout(() => {
                    window.location.reload();
                }, 2500);
            } else {
                $("#responseMessage").html("<p style='color: red;'>" + response.message + "</p>");
            }
        },
        error: function (xhr, status, error) {
            console.error("AJAX Error:", status, error);
            $("#responseMessage").html("<p style='color: red;'>Something went wrong. Please try again.</p>");
        }
    });
});
document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#searchInput").focus();
});

document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    console.log(e);

    window.location.reload();
});
document.getElementById("searchInput").addEventListener("input", () => {
    let input = document.getElementById("searchInput").value.toLowerCase();
    let items = document.querySelectorAll(".dir_item");

    items.forEach(item => {

        let folderName = item.getAttribute("data-dirname").toLowerCase();
        // console.log('folderName', folderName);
        let shouldDisplay = folderName.includes(input);
        item.style.display = shouldDisplay ? "block" : "none";
    });

    // Ensure parent folders of matching files remain visible
    items.forEach(item => {
        if (item.style.display === "block") {
            let parent = item.closest("details");
            while (parent) {
                parent.style.display = "block";
                parent.open = true; // Expand parent folder
                parent = parent.parentElement.closest("details");
            }
        }
    });
});