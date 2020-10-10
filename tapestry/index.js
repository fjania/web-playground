var storyWidth;
var storyHeight;
var storyIdent ;

var startTime = new Date().getTime();

beforeInit = function(){
    // this is a noop on the web
}
afterTap = function(currentPageNumber, currentPauseNumber, pageCount, pauseCount){
    // this is a noop on the web
    var eventData = {
        type: 'tapestry-tap',
        currentTap: currentPauseNumber,
        currentPage: $('.page.visible').data('page'),
        totalTaps: pauseCount,
        totalTimeSpent: new Date().getTime() - startTime
    }
    parent.postMessage(eventData, '*');
}

var tapEngine = (function(){
    var currentPageNumber = -1;
    var currentPauseNumber = -1;
    var autoplayTimer;

    var pageCount = -1;
    var pauseCount = -1;

    var shouldAutoPlay = false;
    var autoPlayInterval = 100;

    var viewRecordSent = false;
    var finishRecordSent = false;

    var states = [];

    function configurePauses(){
        $('#story').children('.page').each(function(i, pageElement){
            pageCount++;
            $(pageElement).attr('data-page', pageCount);
            $(pageElement).css('z-index', pageCount);
            pauseCount++;
            $(pageElement).attr('data-pause', pauseCount);

            $(pageElement).find('.pause').each(function(j, blockElement){
                pauseCount++;
                $(blockElement).attr('data-page', pageCount);
                $(blockElement).attr('data-pause', pauseCount);
            });
        });
    }

    function walkBlocks(ele){
        $(ele).contents().each(function(i,ele){
            if ($(ele).hasClass('page')){
                pageCount++
                pauseCount++
                $(ele).attr('data-page', pageCount);
                $(ele).attr('data-pause', pauseCount);
            } else if ($(ele).hasClass('pauseblock')){
                pauseCount++
                $(ele).attr('data-page', pageCount);
                $(ele).attr('data-pause', pauseCount);
            } else if (ele.nodeType === 3){
                if ($(ele).text().trim().length > 0){
                    $(ele).wrap('<span class="pause" data-page="' + pageCount + '" data-pause="'+ pauseCount +'"></span>');
                }
            } else{
                $(ele).wrap('<span class="pause" data-page="' + pageCount + '" data-pause="'+ pauseCount +'"></span>');
            }
            walkBlocks(ele);
        });
    }

    function configureBlocks(){
        walkBlocks($('#story'));
    }

    function buildStates(){
        var page = '';
        var ppp = [];
        for (var cpn=0; cpn <= pauseCount; cpn++){
            var newPage = $('[data-pause='+ cpn +']').attr('data-page');

            ppp = page == newPage ? ppp : []
            page = newPage;

            ppp.push(cpn);
            states.push(ppp.slice(0));
        }
    }

    function showState(){
        var state = states[currentPauseNumber];

        if (currentPauseNumber <= pauseCount){
            if (currentPauseNumber === 1 && !viewRecordSent){
                parent.postMessage('tapestry-story-start', '*');
                viewRecordSent = true;
            }


            $('.visible').removeClass('visible');

            currentPageNumber = parseInt(
                $('[data-pause='+ currentPauseNumber +']').attr('data-page')
            );

            // Show the page
            $('.page[data-page='+ currentPageNumber +']').addClass('visible')

            // Show all the pauses for this state
            for (var i=0; i < state.length; i++){
                $('[data-pause='+ state[i] +']').addClass('visible');
            }

            afterTap(currentPageNumber, currentPauseNumber, pageCount, pauseCount);
            return true;
        }

        if (currentPauseNumber == pauseCount + 1 && !finishRecordSent){
            parent.postMessage('tapestry-story-finished', '*');
            finishRecordSent = true;
        }

        afterTap(currentPageNumber, currentPauseNumber, pageCount, pauseCount);
        return false;
    }

    function next(){
        if (currentPauseNumber <= pauseCount){
            currentPauseNumber += 1;
            showState()

            if (shouldAutoPlay){
                var localInterval = $(
                    '[data-pause='+ currentPauseNumber +']'
                ).attr(
                    'data-autoplaydelay'
                ) || ''+autoPlayInterval;

                localInterval = parseInt(localInterval);

                setTimeout(function(){
                    next();
                }, localInterval);

            }
        }
    }
    function previous(){
        if (currentPauseNumber - 1 >= 0){
            currentPauseNumber -= 1;
            showState()
        }
    }

    function getCurrentPageNumber(){
        return currentPageNumber;
    }

    function goToPage(pageNumber){
        resetStory();
        for (var i=0; i <= pageNumber; i++){
            currentPageNumber = i;
            $('[data-page='+ currentPageNumber +']').addClass('visible');
        }
        currentPauseNumber = parseInt($('[data-page='+ currentPageNumber +']').last().attr('data-pause'));
    }

    function goToTap(tapNumber){
        resetStory();
        for (var i=0; i <= tapNumber; i++){
            next();
        }
    }

    function autoPlay(interval){
        shouldAutoPlay = true;
        autoPlayInterval = interval;
        next();
    }

    function resetStory(){
        currentPageNumber = -1;
        currentPauseNumber = -1;
        $('.page').removeClass('visible');
        $('.pause').removeClass('visible');
    }

    function init(){
        var pauses = $('#story').find('.pause').length;
        var blocks = $('#story').find('.pauseblock').length;
        beforeInit();
        if ( pauses >= blocks){
            configurePauses();
        } else if ( blocks > pauses ){
            configureBlocks();
        }
        buildStates();
    }

    function replayStory(){
        resetStory();
        next();
    }

    return {
        autoPlay: autoPlay,
        init: init,
        resetStory: resetStory,
        replayStory: replayStory,
        next: next,
        previous: previous,
        getCurrentPageNumber: getCurrentPageNumber,
        goToPage: goToPage,
        goToTap: goToTap
    }
})()

function resizeStory(){

    var stageWidth = $('#stage').width()
    var stageHeight = $('#stage').height()

    var widthFactor = stageWidth / storyWidth;
    var heightFactor = stageHeight / storyHeight;

    var scaleFactor = widthFactor;

    if ( widthFactor > heightFactor ){
        scaleFactor = heightFactor;
    } 

    $('#story').css('-webkit-transform', 'scale(' + scaleFactor + ')');
    $('#story').css('transform', 'scale(' + scaleFactor + ')');
    var scaledStoryWidth = storyWidth * scaleFactor;
    var scaledStoryHeight = storyHeight * scaleFactor;

    $('#story').css('left', parseInt((stageWidth-scaledStoryWidth) / 2))
    $('#story').css('top', parseInt((stageHeight-scaledStoryHeight) / 2))
}

function configureDimensions(){
    var prescribedWidth = $('#story').attr('width') || 1136;
    $('#story').width(prescribedWidth);
    storyWidth = $('#story').width()

    var prescribedHeight = $('#story').attr('height') || 640;
    $('#story').height(prescribedHeight);
    storyHeight = $('#story').height()
}

launchShareDialog = function(text, $clickedElement){
    if ($clickedElement.hasClass('icon-share-alt')) {
        $clickedElement.parent('.twittershare').html(
            "<i class='icon-facebook-sign'></i> <i class='icon-share-alt'></i> <i class='icon-twitter-sign'></i>"
        );
    } else if ($clickedElement.hasClass('icon-facebook-sign')) {
        var url = encodeURIComponent('http://readtapestry.com/s/' + storyIdent + '/?p=' + tapEngine.getCurrentPageNumber())
        window.open(
            "https://www.facebook.com/sharer/sharer.php?u=" + url,
            "ShareWindow",
            "menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=550px,height=310px"
        );

    } else if ($clickedElement.hasClass('icon-twitter-sign')) {
        window.open(
            "https://twitter.com/intent/tweet?text=" + text,
            "ShareWindow",
            "menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=550px,height=310px"
        );
    }
}

function handleTwitterClick(e){
    e.preventDefault();
    e.stopPropagation();
    var tweet_url = encodeURIComponent('http://readtapestry.com/s/' + storyIdent + '/?p=' + tapEngine.getCurrentPageNumber())
    //                           t.co link    ' - ' buffer
    var text_length_limit = 140  - 23          - 3
    var text = $(this).parents('.page').text().trim().replace(/\s+/g, ' ').substring(0, text_length_limit);
    var tweet_text = text + ' - ' + tweet_url;

    launchShareDialog(tweet_text, $(this));
}

function handleLinkClick(e){
    parent.postMessage({
        type: 'tapestry-link-out',
        href: e.target.href
    }, '*');
    e.stopPropagation();
}

function getParameterByName(name) {
    var match = RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return match && decodeURIComponent(match[1].replace(/\+/g, ' '));
}

attachTapHandler = function(){
    var touchcapable = 'ontouchend' in document.documentElement;
    var clickEvent = touchcapable ? 'touchend' : 'click';

    $('#story').on(clickEvent, function(e){
        e.preventDefault();
        e.stopPropagation();
        tapEngine.next()
    });
    $(window).on('keydown', function(e){
        if (e.keyCode == 39){  // 39 = Right arrow
            e.preventDefault();
            e.stopPropagation();
            tapEngine.next();
        } else if (e.keyCode == 37){  // 37 = Left arrow
            e.preventDefault();
            e.stopPropagation();
            tapEngine.previous();
        }
    })
}

function replayStory(e){
    e.preventDefault();
    e.stopPropagation();
    tapEngine.replayStory();
}

function onLoad(){
    var touchcapable = 'ontouchend' in document.documentElement;
    var clickEvent = touchcapable ? 'touchend' : 'click';
    storyIdent = $("meta[property='tapestry:story_id']").attr('content');

    configureDimensions();
    //$('body').prepend("<div id='glass'></div>");
    resizeStory();
    $(window).on('resize', resizeStory);

    tapEngine.init();

    $('.twittershare').html("<i class='icon-share-alt'></i>");

    $('#story').on(clickEvent, '#replay-story', replayStory);

    $('#story').on(clickEvent, '.twittershare i', handleTwitterClick);

    $('a').each(function(idx, val) {
        if(!$(val).attr('target'))
            $(val).attr('target', '_blank');
    });
    $('#story').on(clickEvent, 'a', handleLinkClick);

    attachTapHandler();

    var pageNumber = getParameterByName('p');
    var autoPlay = getParameterByName('a');

    if (pageNumber){
        pageNumber = parseInt(pageNumber);
        tapEngine.goToPage(pageNumber);
    } else if (autoPlay){
        autoPlay = parseInt(autoPlay);
        tapEngine.autoPlay(autoPlay);
    } else {
        tapEngine.next();
    }

    startTime = new Date().getTime();

    // Add the back button
    if (clickEvent == 'click'){
        $('#story').prepend(
            '<div id="back-button"><i class="icon-chevron-left"></i></div>'
        );
        $('#back-button').css({
            'position': 'absolute',
            'bottom': '10px',
            'left': '10px',
            'width': '113px',
            'height': '70px',
            'font-size': '78px',
            'z-index': 2147483647,
            'transition': 'opacity 200ms ease-in-out',
            // Need to make Chrome not flash on opacity animation
            '-webkit-transform': 'translateZ(0)',
            'cursor': 'pointer'
        })
        $('#back-button i').css({
            'position': 'absolute',
            'bottom': '0px',
            'left': '0px',
            'padding': '10px',
            'width': '50px',
            'height': '70px',
            'background': '#000',
            'color': '#FFF',
            'border-radius': '25px'
        })
        $('#back-button').on(clickEvent, function(e){
            e.stopPropagation();
            tapEngine.previous();
        });
    }
}

$(onLoad);
