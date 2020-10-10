var canvas;
var ctx;
var DSTStart = 90;
var DSTEnd = 300;
var wakeup = 360;
var sleep = 1320;
var cHeight;
var cWidth;

var handleFillNormal = "rgb(180, 180, 255)";
var startHandleFill = handleFillNormal;
var endHandleFill = handleFillNormal;
var handleFillHighlight = "rgb(100, 200, 100)";

var handleEdge = 12;
var DSTStartHandleX;
var DSTStartHandleY;
var DSTEndHandleX;
var DSTEndHandleY;

var xMult;
var yMult;

var wakingMinutesInDark;
var sleepingMinutesInLight;

var totalSavingsCountElement;

var wmidElement;
var smilElement;

var startDSTElement;
var endDSTElement;

var startDSTDataElement;
var endDSTDataElement;

var dstChangeHighlightColor = "rgb(80, 180, 80)"
var dstChangeLowlightColor = "rgb(220, 220, 220)"
var dstChangeNormalColor = "rgb(0, 0, 0)"

var dstDataElement;

var showDST = false;
//var mouseUp = false;

var modifyingStart = false;
var modifyingEnd = false;

function init(){
 	canvas = document.getElementById("canvas");
	ctx = canvas.getContext("2d");
	cHeight = canvas.clientHeight;
	cWidth = canvas.clientWidth;
	canvas.width = cWidth;;
	canvas.height = cHeight;;
	xMult = cWidth/365;
	yMult = cHeight/(24*60);

	showDST = document.getElementById("showdst").checked;

	canvas.onmousemove = handleMouse;
	canvas.onmousedown = handleMouseDown;
	canvas.onmouseup = handleMouseUp;

	startDSTElement = document.getElementById("startDSTDate");
	endDSTElement = document.getElementById("endDSTDate");

	startDSTDataElement = document.getElementById("startDSTData");
	endDSTDataElement = document.getElementById("endDSTData");

	dstDataElement = document.getElementById("dstData");

	wmidElement = document.getElementById("wmidCount");
	smilElement = document.getElementById("smilCount");

	totalSavingsCountElement = document.getElementById("totalSavingsCount");

	drawChart();
}

function drawChart(){
/*
	cHeight = canvas.clientHeight;
	cWidth = canvas.clientWidth;
	xMult = cWidth/365;
	yMult = cHeight/(24*60);
*/
	wakingMinutesInDark = 0;
	sleepingMinutesInLight = 0;

	var rise;
	var set;
	var sleepY = cHeight-sleep*yMult; 
	var wakeupY = cHeight-wakeup*yMult; 
	var indexStep = 2;
	
	ctx.clearRect(0,0,cWidth,cHeight);
	// ctx.fillStyle = "rgb(200, 200, 255)";
	// ctx.fillRect(0,0,200,200);
	// ctx.clearRect(0,0,100,100);
	
	DSTStartHandleX = DSTStart*xMult - xMult/2 - handleEdge/2;
	DSTStartHandleY = cHeight-handleEdge; 
	DSTEndHandleX = DSTEnd*xMult + xMult/2 - handleEdge/2;
	DSTEndHandleY = cHeight-handleEdge;

  	ctx.fillStyle = "rgba(200, 200, 200, 0.75)";
	ctx.fillRect(0,0,cWidth,sleepY);
	ctx.fillRect(0,wakeupY,cWidth,cHeight-wakeupY);

	ctx.moveTo(cWidth,wakeupY);
	ctx.lineTo(0,wakeupY);

	ctx.moveTo(cWidth,sleepY);
	ctx.lineTo(0,sleepY);

   ctx.strokeStyle = "#0000ff";
	ctx.stroke();

	//for (var i in sunrise){
	for (var i=0; i < sunrise.length; i+=indexStep){
		rise = cHeight - sunrise[i]*yMult;
		set = cHeight - sunset[i]*yMult;
		if (i >= DSTStart && i <= DSTEnd && showDST){
			rise = cHeight - (sunrise[i] + 60)*yMult;
			set = cHeight - (sunset[i] + 60)*yMult;
		}

		// calc waking minutes in dark
   	ctx.fillStyle = "rgba(180, 180, 255, 1)";
		//ctx.fillRect(i*xMult,sleepY,2,set-(sleepY) );
		//wakingMinutesInDark += (set-sleepY)*indexStep;

		ctx.fillRect(i*xMult,rise,2, Math.max( (wakeupY)-rise,0) );
		wakingMinutesInDark += ( Math.max( (wakeupY)-rise,0) )*indexStep;

		ctx.fillRect(i*xMult,set,2, Math.min( (sleepY)-set,0) );
		wakingMinutesInDark -= ( Math.min( (sleepY)-set,0) )*indexStep;

		// calc sleeping minutes in light
   	ctx.fillStyle = "rgba(255, 180, 180, 1)";
		ctx.fillRect(i*xMult,rise,2, Math.min( (wakeupY)-rise,0) );
		sleepingMinutesInLight -= ( Math.min( (wakeupY)-rise,0) ) * indexStep;

		if (set <= 0) {
			ctx.fillRect(i*xMult,set+cHeight,2, Math.max( (sleepY)-set+cHeight,0) );
			ctx.fillRect(i*xMult,set,2, Math.max( (sleepY)-set,0) );
		} else {
			ctx.fillRect(i*xMult,set,2, Math.max( (sleepY)-set,0) );
		}
		sleepingMinutesInLight += ( Math.max( (sleepY)-set,0) )*indexStep;


      ctx.fillStyle = "#ff0000";
		ctx.fillRect(i*xMult,rise,indexStep*xMult,1);
      ctx.fillStyle = "#0000ff";
		if (set <= 0) {
			ctx.fillRect(i*xMult,set+cHeight,indexStep*xMult,1);
		} else {
			ctx.fillRect(i*xMult,set,indexStep*xMult,1);
		}
  	}
	
	wakingMinutesInDark = Math.round(wakingMinutesInDark);
	sleepingMinutesInLight = Math.round(sleepingMinutesInLight);
	wmidElement.innerHTML = wakingMinutesInDark + " minutes";
	smilElement.innerHTML = sleepingMinutesInLight + " minutes";
	totalSavingsCountElement.innerHTML = wakingMinutesInDarkNoDST + sleepingMinutesInLightNoDST - (wakingMinutesInDark + sleepingMinutesInLight) + " minutes";

	drawDSTBounds();

}

function drawDSTBounds(){
	if (showDST) {
		ctx.lineWidth = 1;
	
   	ctx.fillStyle = startHandleFill;
	//   THIS CODE DOESN"T WORK IN FF3+
	//ctx.moveTo(DSTStart*xMult - xMult/2,0);
	//ctx.lineTo(DSTStart*xMult - xMult/2,cHeight);
	//ctx.stroke();
	//   Need to draw the line as a filled rectangle instead
	ctx.fillRect(DSTStart*xMult - xMult/2, 0, 1, cHeight);
	
   	ctx.fillStyle = startHandleFill;
		ctx.fillRect(DSTStartHandleX, DSTStartHandleY, handleEdge, handleEdge);
	
   	ctx.fillStyle = endHandleFill;
	//   THIS CODE DOESN"T WORK IN FF3+
	//ctx.moveTo(DSTEnd*xMult + xMult/2,0);
	//ctx.lineTo(DSTEnd*xMult + xMult/2,cHeight);
	//ctx.stroke();
	//   Need to draw the line as a filled rectangle instead
	ctx.fillRect(DSTEnd*xMult + xMult/2, 0, 1, cHeight);
	
   	ctx.fillStyle = endHandleFill;
		ctx.fillRect(DSTEndHandleX, DSTEndHandleY, handleEdge, handleEdge);
		dstDataElement.style.color = dstChangeNormalColor;
	} else {
		dstDataElement.style.color = dstChangeLowlightColor;
	}
	startDSTElement.innerHTML = daysToDate(DSTStart); 
	endDSTElement.innerHTML = daysToDate(DSTEnd); 
}

function daysToDate(numDays){
	var daysLeft = numDays;
	var days = daysLeft;
	var month = 1;
	for (var i in daysInMonth){
		if (daysLeft - daysInMonth[i] <= 0){
			days = daysLeft;
			break;
		} else {
			month++;
			daysLeft -= daysInMonth[i];
		}
	}
	return monthNames[month] + " " + days;
}

function handleMouse(e){
	var x = e.pageX - canvas.offsetLeft;
	var y = e.pageY - canvas.offsetTop;


	if ( modifyingStart ){
		startHandleFill = handleFillHighlight;
		DSTStart = Math.round(x/xMult); 	
		startDSTElement.innerHTML = daysToDate(DSTStart); 
		startDSTDataElement.style.color = dstChangeHighlightColor;
		drawChart();
	} else if ( modifyingEnd ){
		endHandleFill = handleFillHighlight;
		DSTEnd = Math.round(x/xMult); 	
		endDSTElement.innerHTML = daysToDate(DSTEnd); 
		endDSTDataElement.style.color = dstChangeHighlightColor;
		drawChart();
	} else if ( inStartHandle(x,y) ){
		startHandleFill = handleFillHighlight;
		startDSTDataElement.style.color = dstChangeHighlightColor;
		//drawDSTBounds();
		drawChart();
	} else if ( inEndHandle(x,y) ){
		endHandleFill = handleFillHighlight;
		endDSTDataElement.style.color = dstChangeHighlightColor;
		//drawDSTBounds();
		drawChart();
	} else {
		startDSTDataElement.style.color = null;
		endDSTDataElement.style.color = null;
		startHandleFill = handleFillNormal;
		endHandleFill = handleFillNormal;
		//drawDSTBounds();
		drawChart();
	}
/*
		dstDataElement.innerHTML = x + ", " + y + "<br>"; 
		for (var a in e){
		dstDataElement.innerHTML += "<b>" + a + ":</b> " + e[a] + "<br>"; 
		}
*/


}

function handleMouseUp(e){
	modifyingEnd = false;
	modifyingStart = false;
	startHandleFill = handleFillNormal;
	endHandleFill = handleFillNormal;
	//drawDSTBounds();
}

function handleMouseDown(e){
	var x = e.pageX - canvas.offsetLeft;
	var y = e.pageY - canvas.offsetTop;
	mouseUp = false;
	mouseDown = true;

	if (inStartHandle(x,y) ) {
		modifyingStart = true;
	} else if (inEndHandle(x,y)) {
		modifyingEnd = true;
	}
}

function inStartHandle(x,y){
	if ( x >= DSTStartHandleX && x <= DSTStartHandleX + handleEdge 
			&&  y >= DSTStartHandleY && y <= DSTStartHandleY + handleEdge ) {
		return true;
	} else {
		return false;
	}
}

function inEndHandle(x,y){
	if ( x >= DSTEndHandleX && x <= DSTEndHandleX + handleEdge 
			&&  y >= DSTEndHandleY && y <= DSTEndHandleY + handleEdge ) {
		return true;
	} else {
		return false;
	}
}

function changeDSTSetting(){
	showDST = document.getElementById("showdst").checked;
/*
	if (showDST) {
		var sx = DSTStart*xMult - xMult/2 - canvas.offsetLeft;
		var ex = DSTEnd*xMult - xMult/2 - canvas.offsetLeft;
		document.getElementById("startdst").style.left = sx;
		document.getElementById("enddst").style.left = ex;
		document.getElementById("startdst").innerHTML = "<B>Start DST</B><br/>" + daysToDate(Math.round(DSTStart));
		document.getElementById("enddst").innerHTML = "<B>End DST</B><br/>" + daysToDate(Math.round(DSTEnd));

		document.getElementById("startdst").style.display = "block";
		document.getElementById("enddst").style.display = "block";
	} else {
		document.getElementById("startdst").style.display = "none";
		document.getElementById("enddst").style.display = "none";
	}
*/
	drawChart();
}

