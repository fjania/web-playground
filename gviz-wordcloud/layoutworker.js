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

START_LAYOUT = "startlayout"
TERM_PLACED = "termplaced"
LAYOUT_COMPLETE = "layoutcomplete"

var cloud = null;
var terms = null;
var stage = null;

var intersectionTests = 0;

var last_intersecting_term = null;
var placed_terms = {}
var half_stage_w;
var half_stage_h;

onmessage = function(e){
    if (e.data['cmd'] == START_LAYOUT){
        cloud = e.data['cloud'];
        terms = cloud.terms;
        stage = e.data['stage'];
        half_stage_w = stage.w/2;
        half_stage_h = stage.h/2;
        layoutCloud();
    }
}

function checkPosition(term_param){
    // OPTIMIZATION - A term is most likely to intersect with the last
    // term it intersected with.
    if (last_intersecting_term != null && intersects(term_param, last_intersecting_term)){
        return false;
    }

    for (var tidx in placed_terms){
        var test_term = placed_terms[tidx];
        if (intersects(term_param, test_term)){
            last_intersecting_term = test_term;
            return false;
        }
    }

    return true;
}

function layoutTerm(term_param){
    var radius = 0;
    var a = (4*Math.random() - 2) * Math.PI;
    var angle = Math.PI;
/**
    var radius_advance = 
        Math.max(
            0.001,
            (Math.sqrt( (term.h)^2 + (term.w)^2 ))/10000
        );
/**/
    //// Old Faithful
    var radius_advance = 0.001;
    var angle_advance = 0.1;

    //// Ok and spread exponential, fast and tight uniform
    //var radius_advance = 0.01;
    //var angle_advance = 1;

    //var radius_advance = 0.1;
    //var angle_advance = 10;

    //// Spiral
    //var radius_advance = .01;
    //var angle_advance = 0.1;

    while (true){
        term_param.x = Math.round( ((radius) * half_stage_w) * Math.cos(angle) ) - term_param.w/2;
        term_param.y = Math.round( ((radius) * half_stage_h) * Math.sin(angle) ) - term_param.h/2;

        if (checkPosition(term_param)){
            break;
        }

        radius += radius_advance;
        angle += angle_advance;
    }

}

function layoutCloud(){
    intersectionTests = 0;
    var termcount = 0;
    placed_terms = {};

    var start = new Date();

    var max = 0;

    for (var term in terms){
        max++;
    }

    for (var term in terms){
        var te = terms[term];

        layoutTerm(te, termcount);
        placed_terms[te.text]=te;
        termcount++;

        postMessage({'cmd': TERM_PLACED, 'term': te.text, 'count': termcount, 'max': max})
    }

    var layouttime = new Date() - start;
    cloud['terms'] = placed_terms;
    postMessage(
        {
            'cmd': LAYOUT_COMPLETE,
            'cloud': cloud,
            'layoutTime': layouttime,
            'termCount': termcount,
            'intersectionTests': intersectionTests
        }
    )
}

// When we calculate intersection we're going to need to translate
// all of the bounding boxes (the term's and all those for its glyphs)
function getTranslatedBoundsRectangles(term_param){
    var translated= []; 
    for (var i in term_param.bounds){
        var b = term_param.bounds[i];
        translated.push(
            [   
                term_param.x - term_param.xoffset + b[0],
                term_param.y - term_param.yoffset + b[1],
                term_param.x - term_param.xoffset + b[2],
                term_param.y - term_param.yoffset + b[3]
            ]   
        );  
    }   

    return translated
}

function intersects(term_param_a, term_param_b){
    intersectionTests++;

    var term_param_a_rects = getTranslatedBoundsRectangles(term_param_a);
    var term_param_b_rects = getTranslatedBoundsRectangles(term_param_b);

    // Test the term's tight bounds first. If it doesn't intersect
    // there is no need to test glyph by glyph
    var ra = term_param_a_rects[0];
    var rb = term_param_b_rects[0];

    var intersecting = !(
        ra[0] > rb[2] ||
        ra[2] < rb[0] ||
        ra[1] > rb[3] ||
        ra[3] < rb[1]
    );

    if (!intersecting){
        return false;
    }   

    // The bounding boxes intersected. Now we want to test glyph by glyph
    // to see if the glyphs intersect, to catch things like space left by
    // ascenders and descenders
    var rai_max = term_param_a_rects.length
    var rbi_max = term_param_b_rects.length
    for (var rbi=1; rbi < rbi_max; rbi++){
        for (var rai=1; rai < rai_max; rai++){
            ra = term_param_a_rects[rai];
            rb = term_param_b_rects[rbi];

            intersecting = !(
                ra[0] > rb[2] ||
                ra[2] < rb[0] ||
                ra[1] > rb[3] ||
                ra[3] < rb[1]
            );  

            if (intersecting){
                return true;
            }   
        }   
    }   

    return false;
}
