/**
 Copyright 2010 Frank Jania

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 **/

var frankjania = {};
START_LAYOUT = "startlayout"
TERM_PLACED = "termplaced"
LAYOUT_COMPLETE = "layoutcomplete"

frankjania.TermCloud = function(container, settings) {
	this.containerElement = container;
    this.debug = false;

    if (typeof(settings) == 'undefined') {
        settings = {};
    }
    this.settings = settings;

    // Some sane default values
    this.defaults = {
        'font-family': 'arial, sans-serif',
        'minFont': 10,
        'maxFont': 50,
    }

    // Hold terms that have been selected
    this.selections = [];

    // Construct the stage - this is where the terms will be placed
    this.stage = document.createElement('div');
    this.stage.id = 'termcloudstage';
    this.stage.style['position'] = 'relative';
    this.containerElement.appendChild(this.stage);

    // The bounds of the stage - we don't rely on the bounds of the
    // stage DOM element since there will be cases when it's not an
    // accurate representation of the actual bounds of the cloud,
    // e.g. during the animation of a transition from one cloud to
    // the next
    this.stageBounds = [0,0,0,0];

    // Center the stage - because I like working with an origin at
    // at (0,0) in the center of the stage
    this.stage.style['top'] = this.containerElement.offsetHeight/2;
    this.stage.style['left'] = this.containerElement.offsetWidth/2;

    // Stage border is just for debugging
    this.stageborder = document.createElement('div');
    this.stageborder.id = 'stageborder';
    this.stageborder.style['border'] = '1px dashed #FF6633';
    this.stageborder.style['position'] = 'absolute';
    this.stageborder.style['left'] = -this.containerElement.offsetWidth/2;
    this.stageborder.style['top'] = -this.containerElement.offsetHeight/2;
    this.stageborder.style['width'] = this.containerElement.offsetWidth/2;
    this.stageborder.style['height'] = this.containerElement.offsetHeight/2;
    this.stageborder.style['display'] = 'none';
    this.stage.appendChild(this.stageborder);

    // Offscreen element used to compute the tight bounding
    // boxes of terms and glyphs
    this.offscreendiv = document.createElement('div');
    this.containerElement.appendChild(this.offscreendiv);
    //this.offscreendiv.style['visibility'] = 'hidden';
    this.offscreendiv.style['overflow'] = 'hidden';
    this.offscreendiv.style['white-space'] = 'nowrap';
    this.offscreendiv.style['position'] = 'absolute';
    this.offscreendiv.style['top'] = '0';
    this.offscreendiv.style['left'] = '0';

    // A cache we use to store terms that we've alread done
    // the work of computing bounds for
    this.termCache = {};
    this.boundsCache = {};

    // The previous cloud. We'll need this so we can know
    // the interection of terms in both to hide terms that are
    // not being displayed in the new cloud
    this.previousCloud = {};

    // The layout worker and it's callback functions.
    // This web worker is where we'll do all the layout for
    // the cloud. Web workers don't block the display thread,
    // so the layout won't make the page become unresponsive
    // TODO: handle the case where web workers aren't available
    // which is apparently any IE < 10, which is still in preview
    this.layoutWorker = new Worker("layoutworker.js");
    this.layoutWorker.termCloud = this;

    this.layoutWorker.onmessage = this.handleWorkerMessage;

    // A regexp we're currently trying to match against, and the
    // low and high opacity values for non-matches and matches
    // respectively
    this.searchPattern = "";
    this.lowOpacity = 0.1;
    this.highOpacity = 1.0;
};

frankjania.TermCloud.prototype.getSetting = function(key){
    if (typeof(this.settings[key]) == "undefined" &&
        typeof(this.defaults[key]) == "undefined"){
        return null;

    } else if (typeof(this.settings[key]) == "undefined"){
        return this.defaults[key];

    } else {
        return this.settings[key];
    }
}

frankjania.TermCloud.prototype.getSelection = function(){
    // return a clone of the selections array so an implementor
    // can't muck with it
    return this.selections.slice(0);
}

frankjania.TermCloud.prototype.setSelection = function(selection){
    if (selection === null || typeof(selection) === 'undefined'){
        this.selections = [];
    } else if (typeof(selection) == 'string') {
        this.selections = [selection];
    } else {
        this.selections = selection;
    }
}

frankjania.TermCloud.prototype.handleWorkerMessage = function(e){
    var termCloud = this.termCloud;
    var command = e.data['cmd']
    if (command == TERM_PLACED){
        var response = e.data;
        google.visualization.events.trigger(termCloud, 'termPlaced', {
            'term': response.term,
            'count': response.count,
            'max': response.max
        });
        //var term = termCloud.termCache[response['text']];
        //term.display(response.x, response.y, true, response.frequency, response.url, response.color);

    } else if (command == LAYOUT_COMPLETE){
        google.visualization.events.trigger(termCloud, 'layoutComplete', e.data);

        // Do the display of the terms
        termCloud.showCloudOnScreen(e.data['cloud']);

    }
};

frankjania.TermCloud.prototype.highlightTerms = function(pattern, lowOpacity, highOpacity){
    this.searchPattern = pattern;
    this.lowOpacity = lowOpacity;
    this.highOpacity = highOpacity;

    for (t in this.termCache){
        this.termCache[t].highlight()
    }
}

frankjania.TermCloud.prototype.showCloudOnScreen = function(current){
    var termTransitions = {};
    var pct = this.previousCloud['terms'];
    var cct = current['terms'];

    for (var t in pct){
        // Assume all terms are disappearing
        termTransitions[pct[t].text] = -1;
    }

    for (var t in cct){
        var term = cct[t].text;
        if (typeof(termTransitions[term]) == "undefined"){
            // It wasn't in the previous cloud, so it's new
            termTransitions[term] = 1;
        } else {
            // It WAS in the previous cloud, so leave it alone
            termTransitions[term] = 0
        }
    }

    for (var text in termTransitions){
        var term = this.termCache[text];

        if (termTransitions[text] == -1){
            term.hide(true);
            continue;
        }

        var layoutParameters = cct[text];

        if (termTransitions[text] == 1){
            term.display(layoutParameters, true);

        } else if (termTransitions[text] == 0){
            term.display(layoutParameters, true);
        }
    }

    this.zoomCloudToContainer(cct);
    this.previousCloud = current;
}

frankjania.TermCloud.prototype.zoomCloudToContainer = function(terms){
    var b = [0,0,0,0];

    for (var termtext in terms) {
        term = terms[termtext];
        b = [
            Math.min(term.x, b[0]),
            Math.min(term.y, b[1]),
            Math.max(term.x+term.w, b[2]),
            Math.max(term.y+term.h, b[3])
        ];
    }

    if (this.debug){
        this.stageborder.style['display'] = 'block';
        this.stageborder.style['left'] = b[0];
        this.stageborder.style['top'] = b[1];
        this.stageborder.style['width'] = b[2] - b[0];
        this.stageborder.style['height'] = b[3] - b[1];
    } else {
        this.stageborder.style['display'] = 'none';
    }

    factor = Math.min(
        Math.abs((this.containerElement.offsetWidth/2) / b[0]),
        Math.abs((this.containerElement.offsetWidth/2) / b[2]),
        Math.abs((this.containerElement.offsetHeight/2) / b[1]),
        Math.abs((this.containerElement.offsetHeight/2) / b[3])
    );

    this.stage.style['-webkit-transform-origin'] = '0 0';
    this.stage.style['-webkit-transition'] = 'all 0.35s linear';
    this.stage.style['-webkit-transform'] = 'scale(' + factor + ')';
    this.stage.style['-moz-transform-origin'] = '0 0';
    this.stage.style['-moz-transition'] = 'all 0.35s linear';
    this.stage.style['-moz-transform'] = 'scale(' + factor + ')';
    this.stage.style['MozTransition'] = 'all.0.35s linear';
    this.stage.style['MozTransformOrigin'] = '0 0';
    this.stage.style['MozTransform'] = 'scale(' + factor + ')';
}

frankjania.TermCloud.prototype.getTerm = function(text) {
    if (typeof this.termCache[text] == 'undefined'){
        this.termCache[text] = new frankjania.Term(this, text);
    }
    return this.termCache[text];
}

frankjania.TermCloud.prototype.draw = function(datatable, id) {

    var cloud = new frankjania.Cloud(this, datatable, id);

    var startmessage = {
        "cmd": START_LAYOUT,
        "stage": {
            "w": this.containerElement.offsetWidth,
            "h": this.containerElement.offsetHeight
        },
        "cloud": cloud.serialize(),
    }

    this.layoutWorker.postMessage(startmessage);
}

// If the implementer has an already-laid-out cloud, e.g. from a cache
// just 'blast' it to the screen.
frankjania.TermCloud.prototype.blast = function(cloud) {
    this.showCloudOnScreen(cloud);
}

/******************************************************************************
 ** Cloud object
******************************************************************************/
frankjania.Cloud = function(termCloud, datatable, id){
    this.isLaidOut = false;
    this.datatable = datatable;
    this.termCloud = termCloud;
    this.terms = {}
    this.cloudID = id;

    var row_count = datatable.getNumberOfRows()
    if (row_count < 1) {
        return;
    }

    datatable.sort([{column: 1, desc: true}])
    this.maxFrequency = parseFloat(datatable.getFormattedValue(0, 1));

    for (var row = 0; row < row_count; row++) {
        //var date = datatable.getValue(row, 0).getTime();
        var text = datatable.getFormattedValue(row, 0);
        var frequency = parseFloat(datatable.getFormattedValue(row, 1));
        var url = datatable.getFormattedValue(row,2);
        var color = datatable.getFormattedValue(row,3);

        this.terms[text] = {"term": termCloud.getTerm(text), "freq": frequency, "url": url, "color": color};
    }

}

// We need a serialized version of the cloud when we want to
// pass it to the layout worker
frankjania.Cloud.prototype.serialize = function(){
    // TODO - sort the terms by frequency
    var output = {};

    output['cloudID'] = this.cloudID;
    output['maxFrequency'] = this.maxFrequency;

    output['terms'] = [];
    for (var text in this.terms){
        var t = this.terms[text];
        output['terms'].push(t['term'].serialize(this.getFontSize(t.freq), t.freq, t.url, t.color));
    }
    return output;
}

frankjania.Cloud.prototype.getFontSize = function(frequency){
    var minFont = this.termCloud.getSetting('minFont');
    var maxFont = this.termCloud.getSetting('maxFont');
    return minFont + (maxFont-minFont) * frequency / this.maxFrequency;
}


/******************************************************************************
 ** Term object
******************************************************************************/
frankjania.Term = function(termCloud, text){
    this.text = text;
    this.termCloud = termCloud;

    this.element = document.createElement('span');
    this.element.className = 'term';
    this.element.id = this.text;
    this.element.textContent = this.text;

    // This doesn't work in FF for some reason.
    this.element.style['text-decoration'] = 'none';
    this.element.style['font-family'] = termCloud.getSetting('font-family');

    this.element.style['visibility'] = 'hidden';
    this.element.style['white-space'] = 'nowrap';
    this.element.style['position'] = 'absolute';

    this.element.style['cursor'] = 'pointer';
    this.element.style['-webkit-user-select'] = 'none';
    this.element.style['-khtml-user-select'] = 'none';
    this.element.style['-moz-user-select'] = 'none';
    this.element.style['-o-user-select'] = 'none';
    this.element.style['user-select'] = 'none';
    //this.element.style['left'] = 0;
    //this.element.style['top'] = 0;

    var term = this;
    this.element.onclick = function(e){
        term.handleMouseEvent(e);
    }
    this.element.ondblclick = function(e){
        term.handleMouseEvent(e);
    }

    this.termCloud.stage.appendChild(this.element)
}

frankjania.Term.prototype.handleMouseEvent = function(e){
    if (e.type === 'click'){
        // Handle multiselect
        if (e.metaKey || e.shiftKey){
            //append or remove
            var s = this.termCloud.getSelection();
            if ( s.indexOf(term.text) > -1 ){
                s.splice(s.indexOf(this.text), 1);
            } else {
                s.push(this.text);
            }

           this.termCloud.setSelection(s);

        } else {
           this.termCloud.setSelection(this.text);
        }
        google.visualization.events.trigger(this.termCloud, 'select', {});

    } else if (e.type === 'dblclick'){
        google.visualization.events.trigger(this.termCloud, 'dblclick', {'term': this, 'termCloud': this.termCloud});
    }
}

frankjania.Term.prototype.serialize = function(fontSize, frequency, url, color){
    var bounds = this.computeTightBounds(fontSize, 1.0);
    var term_bounds = bounds[0];


    params = {
        "text": this.text,
        "xoffset": term_bounds[0],
        "yoffset": term_bounds[1],
        "x": 0,
        "y": 0,
        "x2": term_bounds[2],
        "y2": term_bounds[3],
        "w": term_bounds[2] - term_bounds[0],
        "h": term_bounds[3] - term_bounds[1],
        "fontSize": fontSize,
        "frequency": frequency,
        "url": url,
        "color": color,
        "bounds": bounds
    };

    return params;
}

frankjania.Term.prototype.highlight = function(){
    if (this.text.search(new RegExp(this.termCloud.searchPattern)) > -1){
        this.element.style['opacity'] = this.termCloud.highOpacity;
    } else {
        this.element.style['opacity'] = this.termCloud.lowOpacity;
    }
}

frankjania.Term.prototype.hide = function(animate){
    this.setAnimation(animate);
    this.element.style['visibility'] = 'hidden';

    this.element.style['-webkit-transform'] = 'scale(0)';
    this.element.style['-moz-transform'] = 'scale(0)';
    this.element.style['MozTransform'] = 'scale(0)';

    this.highlight()
}

frankjania.Term.prototype.display = function(params, animate){
    this.setAnimation(animate);
    this.element.style['visibility'] = 'visible';
    this.element.style['-webkit-transform'] = 'scale(1)';
    this.element.style['-moz-transform'] = 'scale(1)';
    this.element.style['MozTransform'] = 'scale(1)';

    this.element.style['left'] = params.x - params.xoffset;
    this.element.style['top'] = params.y - params.yoffset;

    this.element.style['font'] = params.fontSize + 'pt ' + this.termCloud.getSetting('font-family');
    this.element.setAttribute('href', params.url);
    this.element.style['color'] = params.color;
    this.highlight()

    if (this.termCloud.debug){
        var de= document.createElement('div');
        de.style['position'] = 'absolute';
        de.style['border'] = "1px solid #FFFFFF";
        de.style['left'] = params.x;
        de.style['top'] = params.y;
        de.style['width'] = params.w;
        de.style['height'] = params.h;

        this.termCloud.stage.appendChild(de)
    }
}

frankjania.Term.prototype.setAnimation = function(animate){
    if (animate){
        this.element.style['-webkit-transition'] = 'all 0.35s linear';
        this.element.style['WebkitTransition'] = 'all 0.35s ease-out';
        this.element.style['-moz-transition'] = 'all 0.35s linear';
        this.element.style['MozTransition'] = 'all 0.35s ease-out';
        this.element.style['Transition'] = 'all 0.35s ease-out';
    } else {
        this.element.style['-webkit-transition'] = '';
        this.element.style['WebkitTransition'] = '';
        this.element.style['-moz-transition'] = '';
        this.element.style['MozTransition'] = '';
        this.element.style['Transition'] = '';
    }
}

frankjania.Term.prototype.computeTightBounds = function(size, inflate){
    if (this.termCloud.boundsCache[this.text]){
        if (this.termCloud.boundsCache[this.text][+size]){
            return this.termCloud.boundsCache[this.text][+size]
        }
    }
    var osd = this.termCloud.offscreendiv;

    osd.style['font'] = size + 'pt ' + this.termCloud.getSetting('font-family');

    for (var i in this.text){
        var s = document.createElement('span');
        s.appendChild( document.createTextNode(this.text.charAt(i)) );
        osd.appendChild(s);
    }

    var term_bounds = [osd.offsetWidth,osd.offsetHeight,0,0];
    var bounds = [null];

    var canvas = document.createElement("canvas");
    if (canvas.getContext) {
        canvas.width = osd.offsetWidth;
        canvas.height = osd.offsetHeight;

        var ctx = canvas.getContext("2d");
        ctx.textBaseline = 'bottom';
        ctx.font = osd.style['font'];

        // Fill the context with transparent black so checking on the color values
        // for an aggregate of pixels an empty region will add to 0
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Set the context to be filled with opaque black, so that any check on color
        // will be > 0 if there is text drawn there.
        ctx.fillStyle = "rgba(0,0,0,255)";

        // Draw the text
        // Problems with this...
        // 1- Arabic is drawn as cursive, but span-by-span layout is not
        // 2- Setting the textBaseLine to 'bottom' makes this as accurate
        //    as possible, but for very large terms, this could be off by
        //    as much as 20 pixels. The discrepancy seems ok for text up
        //    to around 100pt
        ctx.fillText(this.text, 0, osd.offsetHeight);

        for (var i in osd.childNodes){
            var e = osd.childNodes[i]
            if (typeof(e) == "object" && e.textContent != " "){
                var b = this.getTightBounds(ctx, e, inflate);
                if (b != null){
                    bounds.push(b);
                    term_bounds[0] = Math.min(b[0], term_bounds[0]);
                    term_bounds[1] = Math.min(b[1], term_bounds[1]);
                    term_bounds[2] = Math.max(b[2], term_bounds[2]);
                    term_bounds[3] = Math.max(b[3], term_bounds[3]);
                }
            }
        }

        bounds[0] = term_bounds;
    } else {
        bounds = [0, 0, osd.offsetWidth, osd.offsetHeight];
    }

    // Clean out the offscreen div used for calculating the tight bounds
    while (osd.hasChildNodes()) {
       osd.removeChild(osd.lastChild);
    }

    if (!this.termCloud.boundsCache[this.text]){
        this.termCloud.boundsCache[this.text] = {}
    }
    this.termCloud.boundsCache[this.text][""+size] = bounds

    return bounds;

}

frankjania.Term.prototype.getTightBounds = function(ctx, elem, inflate){
    var w = elem.offsetWidth;
    var h = elem.offsetHeight;
    var xOffset = elem.offsetLeft;

    var id = ctx.getImageData(xOffset, 0, w, h)

    var left_pixel = 0;
    var left_pixel_found = false;

    var top_pixel = 0;
    var top_pixel_found = false;

    var right_pixel = w;
    var right_pixel_found = false;

    var bottom_pixel = h;
    var bottom_pixel_found = false;

    while (!top_pixel_found || !bottom_pixel_found || !left_pixel_found || !right_pixel_found){

        left_pixel = left_pixel_found ? left_pixel : ++left_pixel
        top_pixel = top_pixel_found ? top_pixel : ++top_pixel
        right_pixel = right_pixel_found ? right_pixel : --right_pixel;
        bottom_pixel = bottom_pixel_found ? bottom_pixel : --bottom_pixel;

        var top_color = 0;
        var bottom_color = 0;

        for (var i=0; i<w; i++){
            var t_index = (top_pixel*4) * w + (i*4);
            var b_index = (bottom_pixel*4) * w + (i*4);
            top_color +=    id.data[t_index] + id.data[t_index+1] + id.data[t_index+2] + id.data[t_index+3];
            bottom_color += id.data[b_index] + id.data[b_index+1] + id.data[b_index+2] + id.data[b_index+3];
        }

        top_pixel_found = top_pixel_found ? true : top_color > 0;
        bottom_pixel_found = bottom_pixel_found ? true : bottom_color > 0;

        var left_color = 0;
        var right_color = 0;

        for (var j=0; j<h; j++){
            var l_index = (j*4) * w + (left_pixel*4);
            var r_index = (j*4) * w + (right_pixel*4);
            left_color +=  id.data[l_index] + id.data[l_index+1] + id.data[l_index+2] + id.data[l_index+3];
            right_color += id.data[r_index] + id.data[r_index+1] + id.data[r_index+2] + id.data[r_index+3];
        }

        left_pixel_found = left_pixel_found ? true : left_color > 0;
        right_pixel_found = right_pixel_found ? true : right_color > 0;

        // Something failed in the line sweep - bail out
        if ( left_pixel > w || right_pixel < 0 || top_pixel > h || bottom_pixel < 0 ){
            return null;
        }
    }

    return [
        left_pixel + xOffset - 1 - inflate,
        top_pixel - 1 - inflate,
        right_pixel + xOffset + 1 + 2*inflate,
        bottom_pixel + 1 + 2*inflate
    ];
}

