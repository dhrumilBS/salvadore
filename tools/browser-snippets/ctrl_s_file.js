$(document).ready(function () {
    function copyCode(Text) {
        console.log(Text);
        var textToCopy = Text;
        var tempInput = document.createElement('input');
        tempInput.value = textToCopy;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
    }

    var inputField = $('#attachment-details-two-column-title');
 
    inputField.click(function () {
        var modifiedText = inputField.val().replace(/-/g, ' ').replace(/\s/g, ' ');
        inputField.val(modifiedText);
        inputField.select();
        document.execCommand('copy');
        inputField.blur();
    });

    if ($('#attachment-details-title').length) {
        $('#attachment-details-title').on('dblclick', function () {
            copyCode($(this).val());
        });
    }

    $(document).keydown(function (e) {
        // Check if the key combination is Ctrl + S
        if ((e.which == 83 || e.which == 115) && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            $('.editor-post-save-draft, .editor-post-publish-button, #publish, #submit').click();
        }
        if ($('.delete-attachment').length) {
            if (e.ctrlKey && e.keyCode === 46) {
                e.preventDefault();
                $('.delete-attachment').click();
            }
        }
    });
});