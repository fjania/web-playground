var preview_slide_number = 0;
var preview_slide_max = 0;

function buildSlides(e){
    preview_slide_number = 0;
    preview_slide_max = 0;
    var characters_in = 0;
    var previewed = false

    var caret = document.getElementById('essay_text').selectionStart
    var content = $('#essay_text').val();
    $('#slides').empty();
    $('#preview').empty();
    var slide_content = content.trim().split('\n');
    var slide_len = slide_content.length;
    for (var n=0; n < slide_len; n++){
        if (slide_content[n].indexOf('[') == 0){

            sc = slide_content[n];
            characters_in += sc.length + 1;
            var imgsrc = "";
            try {
                imgsrc = sc.match(/\[(.*)\]/)[1];
            } catch (err) {
            }
            console.log(imgsrc)
            $('#slides').append('<div class="slide"><img src="' + imgsrc + '"/></div>');
            $('#preview').append('<div class="slide" id="preview_slide_' + preview_slide_max +'" style="display: none"><img src="' + imgsrc + '"/></div>');
            if (caret < characters_in && !previewed){
                $('#preview_slide_' + preview_slide_max).show();
                preview_slide_number = preview_slide_max;
                previewed = true;
            }
            preview_slide_max += 1;

        } else {

            var line_content = slide_content[n].split('|');
            var line_len = line_content.length;

            for (var x=0; x < line_len; x++){
                var text = "";
                characters_in += line_content[x].length;
                if (x < line_len){
                    characters_in += 1;
                }
                for (var y=0; y <= x; y++){
                    text += line_content[y]
                    if (y < x){
                        text += " ";
                    }
                }
                $('#slides').append('<div class="slide">' + text + '</div>');
                $('#preview').append('<div class="slide" id="preview_slide_' + preview_slide_max +'" style="display: none">' + text + '</div>');
                if (caret < characters_in && !previewed){
                    $('#preview_slide_' + preview_slide_max).show();
                    preview_slide_number = preview_slide_max;
                    previewed = true;
                }
                preview_slide_max += 1;
            }
        }
    }
}

function handleInput(){
    $('#essay_text').focus();
    $('#essay_text').on('keyup paste click', buildSlides);

    $('#preview').on('click', function(){
        $('#preview').children().hide();
        preview_slide_number += 1;
        if (preview_slide_number >= preview_slide_max){
            preview_slide_number = 0;
        }
        $('#preview_slide_' + preview_slide_number).show();
    });
    buildSlides();
}

$(handleInput)
