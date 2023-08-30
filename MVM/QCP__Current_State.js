const DEBUG = true;

function log(...args) {
if (DEBUG) {
console.log(...args);
}
}

export function isFieldEditableForObject(fieldName, record, conn, objectName) {
    if (
      (objectName === "QuoteLine__c" &&
        (fieldName === "NEO_List_Unit_Price__c" ||
          fieldName === "NEO_Monthly_Net_Unit_Price_Primary__c")) ||
      (fieldName === "Target_Monthly_Net_Unit_Price__c" &&
        fieldName === SBQQ__UpgradedSubscription__c)
    ) {
      return false;
    }
    // Check if the current object being evaluated is a "QuoteLine__c" object
    if (
      objectName === "QuoteLine__c" &&
      // Ensure the field being evaluated is "NEO_Target_Monthly_Net_Unit_Price__c"
      fieldName === "NEO_Target_Monthly_Net_Unit_Price__c" &&
      // Check if the "Upgraded Subscription" field is populated (not null, undefined, or empty string)
      record.SBQQ__UpgradedSubscription__c !== null &&
      record.SBQQ__UpgradedSubscription__c !== undefined &&
      record.SBQQ__UpgradedSubscription__c !== ""
    ) {
      // If all conditions are met, lock the "NEO_Target_Monthly_Net_Unit_Price__c" field by making it non-editable
      return false;
    }
  }

export function onAfterCalculate(quoteModel, quoteLineModels) {
return new Promise((resolve, reject) => {
//Set up a map to work through segments, makes dealing with segments per line easier
//These are split out in case future modifications need to be made on a per type basis
var netNewSegmentMap = new Map();
var amendmentRenewalSegmentMap = new Map();
var overrideSegmentMap = new Map();

//copy & pasted below code to first loop through & default override 
//Loop quote lines and assign to map by segment key
quoteLineModels.forEach(quoteLine => {
//filter out non-segmented products for all
if (quoteLine.record.SBQQ__SegmentKey__c != null) {
if (!overrideSegmentMap.has(quoteLine.record.SBQQ__SegmentKey__c)) {
overrideSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, new Array());
}
overrideSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
}
});
if (overrideSegmentMap.size > 0) {
overrideSegmentMap.forEach(overrideSegmentArray => {
var previousQuoteLineOverride;
//This really shouldn't necessarily be required and is more of a failsafe - lines should be coming in 'pre-sorted' by CPQ in a sequence that should work for us when mapping the original segment map
overrideSegmentArray.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);
overrideSegmentArray.forEach(qlSegment => {
if (previousQuoteLineOverride != null) {
if (validateHWR(quoteModel, qlSegment, previousQuoteLineOverride)) {
//Throw an error provided all of this is satisfied
reject(
'You’ve attempted to save a quote where year 2+ has a lower quantity than year 1. Only Power Users may save with this criteria. Please adjust the quantity and save again',
);
}
}
previousQuoteLineOverride = qlSegment;
});
});
inheritOverrideFromFirstSegment(overrideSegmentMap);
}

//continuing with unmodified code
//Loop quote lines and assign to map by segment key
quoteLineModels.forEach(quoteLine => {
//filter out non-segmented products for all
if (quoteLine.record.SBQQ__SegmentKey__c != null && !quoteLine.record.NEO_Override_ACV__c) {
//Reset ACV's for a clean calc
resetLine(quoteLine);
//Net new map assign
if (quoteLine.record.Original_Subscription__c == null && quoteLine.record.SBQQ__RenewedSubscription__c == null) {
if (!netNewSegmentMap.has(quoteLine.record.SBQQ__SegmentKey__c)) {
netNewSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, new Array());
}
netNewSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
}
//Amendment map assign
if (quoteLine.record.Original_Subscription__c != null || quoteLine.record.SBQQ__RenewedSubscription__c != null) {
if (!amendmentRenewalSegmentMap.has(quoteLine.record.SBQQ__SegmentKey__c)) {
amendmentRenewalSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, new Array());
}
amendmentRenewalSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
}
}
});
//Run intiial hwm product quantity validation - we have to run this on all sides - net new, amendment, and renewal - but it will only run for what is populated on the quote
//Run net new
if (netNewSegmentMap.size > 0) {
netNewSegmentMap.forEach(netNewSegmentArray => {
var previousQuoteLine;
//This really shouldn't necessarily be required and is more of a failsafe - lines should be coming in 'pre-sorted' by CPQ in a sequence that should work for us when mapping the original segment map
netNewSegmentArray.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);
netNewSegmentArray.forEach(qlSegment => {
if (previousQuoteLine != null) {
if (validateHWR(quoteModel, qlSegment, previousQuoteLine)) {
//Throw an error provided all of this is satisfied
reject(
'You’ve attempted to save a quote where year 2+ has a lower quantity than year 1. Only Power Users may save with this criteria. Please adjust the quantity and save again',
);
}
}
previousQuoteLine = qlSegment;
});
});
inheritValuesFromFirstSegment(netNewSegmentMap);
netNewACV(netNewSegmentMap);
}
//Run amendment/renewal
if (amendmentRenewalSegmentMap.size > 0) {
amendmentRenewalSegmentMap.forEach(amendmentRenewalSegmentArray => {
var previousQuoteLine;
//This really shouldn't necessarily be required and is more of a failsafe - lines should be coming in 'pre-sorted' by CPQ in a sequence that should work for us when mapping the original segment map
amendmentRenewalSegmentArray.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);
amendmentRenewalSegmentArray.forEach(qlSegment => {
if (previousQuoteLine != null) {
if (validateHWR(quoteModel, qlSegment, previousQuoteLine)) {
//Throw an error provided all of this is satisfied
reject(
'You’ve attempted to save a quote where year 2+ has a lower quantity than year 1. Only Power Users may save with this criteria. Please adjust the quantity and save again',
);
}
}
previousQuoteLine = qlSegment;
});
});
inheritValuesFromFirstSegment(amendmentRenewalSegmentMap);
amendmentRenewalACV(quoteModel, amendmentRenewalSegmentMap);
}
resolve('');
});
}

//Return bool logic for HWR validation
function validateHWR(quoteModel, qlSegment, previousQuoteLine) {
return (
quoteModel.record.NEO_Contract_Type__c == 'Standard' &&
qlSegment.record.HWM_Product__c &&
!quoteModel.record.NEO_Is_it_Power_Users__c &&
qlSegment.record.SBQQ__Quantity__c != 0 &&
previousQuoteLine.record.SBQQ__Quantity__c > qlSegment.record.SBQQ__Quantity__c
);
}

function amendmentRenewalACV(quoteModel, segmentMap) {
segmentMap.forEach(segmentArray => {
var counter = 0;
var segmentPartial = 0;
var previousQuoteLine;
var previousAcv = 0;
segmentArray.forEach(qlSegment => {
counter++;
//These are split out for readability of the calculation
var mrr = qlSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c;
var quantity = qlSegment.record.SBQQ__Quantity__c;
var offsetMonths = qlSegment.record.NEO_Offset_Months__c;
var acv = mrr * quantity * (12 - offsetMonths);
var subACV = qlSegment.record.NEO_Subscription_ACV__c;
//Future segment
//This will hold the subsequent segment if possible
var futureQuoteLine = counter < segmentArray.length ? segmentArray[counter] : null;
var nextMRR = futureQuoteLine != null ? futureQuoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c : 0;
var nextQuantity = futureQuoteLine != null ? futureQuoteLine.record.SBQQ__Quantity__c : 0;
var nextOffset = futureQuoteLine != null ? futureQuoteLine.record.NEO_Offset_Months__c : 0;
var nextACV = nextMRR * nextQuantity * nextOffset;
//Previous segment
var previousMRR = previousQuoteLine != null ? previousQuoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c : 0;
var previousQuantity = previousQuoteLine != null ? previousQuoteLine.record.SBQQ__Quantity__c : 0;
var previousOffset = previousQuoteLine != null ? previousQuoteLine.record.NEO_Offset_Months__c : 0;
var subscriptionACV = subACV != null ? qlSegment.record.NEO_Subscription_ACV__c : 0;
//Final ACV
var finalACV = 0;

//Specific math for segment 1 on amendment/replacement lines
if (qlSegment.record.SBQQ__SegmentIndex__c == 1 && qlSegment.record.Original_Subscription__c != null) {
//ACV Calc:
finalACV = ((mrr * quantity * (12 - offsetMonths)) + (mrr * qlSegment.record.NEO_Subscription_Prior_Quantity__c * offsetMonths)) - subscriptionACV;
}
//Specific math for segment 1 on renewal lines
if (qlSegment.record.SBQQ__SegmentIndex__c == 1 && qlSegment.record.SBQQ__RenewedSubscription__c != null) {
    //ACV Calc:
    finalACV = ((mrr * quantity * (12 - offsetMonths)) + (qlSegment.record.NEO_Renewed_Monthly_Net_Unit_Price__c * qlSegment.record.NEO_Subscription_Prior_Quantity__c * offsetMonths)) - subscriptionACV;
    }
//we want to do a different ACV calc for renewal quote lines on years 2+
if ((qlSegment.record.SBQQ__SegmentIndex__c > 1) && (qlSegment.record.SBQQ__RenewedSubscription__c != null)) {

//same calc as other years, but leave out subscription ACV for years 2+
finalACV = (acv + (previousMRR * previousQuantity * previousOffset)) - previousAcv;
}

//if quote line is amended/replacement quote line, used for years 2+
if ((qlSegment.record.SBQQ__SegmentIndex__c > 1) && (qlSegment.record.Original_Subscription__c != null)) {

finalACV = (acv + (previousMRR * previousQuantity * previousOffset)) - previousAcv - subscriptionACV;
    //calc for this year's ACV if it is an amended quote line:
}

//If the effective quantity is 0 (amended line with no change) set the acv to 0
if ((qlSegment.record.SBQQ__UpgradedSubscription__c != null && qlSegment.record.SBQQ__EffectiveQuantity__c == 0) || (quoteModel.record.Amendment_Quote_Type__c == 'Cancelled and Replaced Quote')) { 
    finalACV = 0;
}
previousAcv += finalACV;
log(
'segment',
qlSegment.record.SBQQ__SegmentIndex__c,
'cmrr',
mrr,
'cquant',
quantity,
'coffset',
offsetMonths,
'cacv',
acv,
'cSSMRA',
qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c,
'fmrr',
nextMRR,
'foffset',
nextOffset,
'facv',
nextACV,
'pmrr',
previousMRR,
'pquant',
previousQuantity,
'poffset',
previousOffset,
'segmentPartial',
segmentPartial,
'final acv',
finalACV,
'Amend Type',
quoteModel.record.Amendment_Quote_Type__c,
'Prev ACV',
previousAcv,
);

setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c, finalACV);

if (qlSegment.record.SBQQ__SegmentIndex__c == segmentArray.length && finalACV != 0 && offsetMonths != 0) {
    var stubACV = (mrr * 12 * quantity) - previousAcv - subscriptionACV != 0 ? (mrr * 12 * quantity) - previousAcv - subscriptionACV : null;
    setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c + 1, stubACV);
    }   

previousQuoteLine = qlSegment;
});
});
}

function inheritValuesFromFirstSegment(segmentMap) {
segmentMap.forEach(segmentArray => {
// Identify the first segment
let firstSegment = segmentArray[0];
// Set values on subsequent segments based on the first segment
segmentArray.slice(1).forEach(qlSegment => {
qlSegment.record.NEO_Offset_Months__c = firstSegment.record.NEO_Offset_Months__c;
qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c = firstSegment.record.NEO_Subsequent_Segments_MRR_Additional__c;
});
});
}
//I copy & pasted the above function in order to call the override default at a different point in the calc 
function inheritOverrideFromFirstSegment(segmentMap) {
segmentMap.forEach(segmentArray => {
// Identify the first segment
let firstSegment = segmentArray[0];
// Set override acv on subsequent segments based on the first segment
segmentArray.slice(1).forEach(qlSegment => {
qlSegment.record.NEO_Override_ACV__c = firstSegment.record.NEO_Override_ACV__c;
});
});
}
function netNewACV(segmentMap) {
segmentMap.forEach(segmentArray => {
//Sort based on segment index - asc
var previousQuoteLine;
var runningACVTotal = 0;
segmentArray.forEach(qlSegment => {
//These are split out for readability of the calculation
var mrr = qlSegment.record.NEO_Total_Monthly_Net_Unit_Price__c;
var subscriptionACV = qlSegment.record.NEO_Subscription_ACV__c;
var replaceSubACV = subscriptionACV != null ? qlSegment.record.NEO_Subscription_ACV__c : 0;
var subscriptionTerm = qlSegment.effectiveSubscriptionTerm;
var offsetMonths = qlSegment.record.NEO_Offset_Months__c;
var acv = (mrr * (subscriptionTerm - offsetMonths)) - replaceSubACV;
log('initial ACV: ', qlSegment.record.SBQQ__SegmentIndex__c, acv);
//For index 2 and beyond we need to rely on the previously calculated line
if (previousQuoteLine != null) {
var previousMRR = previousQuoteLine.record.NEO_Total_Monthly_Net_Unit_Price__c;
//Add in the carryover from previous year
console.log('previousMRR * offset', qlSegment.record.SBQQ__SegmentIndex__c, previousMRR * offsetMonths);
acv += previousMRR * offsetMonths;
console.log('post addition', qlSegment.record.SBQQ__SegmentIndex__c, acv);
//Subtract current total
acv -= runningACVTotal;
}
if (previousQuoteLine == null) {
    acv - replaceSubACV;
}
//Close out ACV calculation
//Add total to running total
runningACVTotal += acv;
log('runningACV', runningACVTotal);
log('final ACV: ', qlSegment.record.SBQQ__SegmentIndex__c, acv);
//Since this is field specific instead of a generic field, this passes to this function to just assign the correct field with the correct info
setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c, acv);
//Check to make sure that the array is greater than 1 to see if we even need to bother with the stub
if (qlSegment.record.SBQQ__SegmentIndex__c == segmentArray.length) {
var stubACV = mrr * 12 - runningACVTotal != 0 ? mrr * 12 - runningACVTotal : null;
setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c + 1, stubACV);
}

//Set this line to our ref to be used in the next loop
previousQuoteLine = qlSegment;
});
});
}

//This function splits on the segmentIndex provided so we can handle the stub period at the end of a series of segments
function setACVOnLine(quoteLine, segmentIndex, acv) {
switch (segmentIndex) {
case 1:
quoteLine.record.NEO_Year_1_ACV__c = acv;
break;
case 2:
quoteLine.record.NEO_Year_2_ACV__c = acv;
break;
case 3:
quoteLine.record.NEO_Year_3_ACV__c = acv;
break;
case 4:
quoteLine.record.NEO_Year_4_ACV__c = acv;
break;
case 5:
quoteLine.record.NEO_Year_5_ACV__c = acv;
break;
}
}





//In case the term changes and we adjust segments rendered, this will ensure we don't have bad data leftover from prior calcs
function resetLine(quoteLine) {
quoteLine.record.NEO_Year_1_ACV__c = null;
quoteLine.record.NEO_Year_2_ACV__c = null;
quoteLine.record.NEO_Year_3_ACV__c = null;
quoteLine.record.NEO_Year_4_ACV__c = null;
quoteLine.record.NEO_Year_5_ACV__c = null;
}


/*
QuoteLine Fields:
NEO_Total_Monthly_Net_Unit_Price__c
SBQQ__SegmentIndex__c
SBQQ__SegmentKey__c
NEO_Year_1_ACV__c
NEO_Year_2_ACV__c
NEO_Year_3_ACV__c
NEO_Year_4_ACV__c
NEO_Year_5_ACV__c
HWM_Product__c
SBQQ__Quantity__c
NEO_Subscription_ACV__c
SBQQ__UpgradedSubscription__c
SBQQ__RenewedSubscription__c
NEO_Monthly_Net_Unit_Price_Primary__c
NEO_Renewed_Monthly_Net_Unit_Price__c
NEO_Monthly_Net_Unit_Price_Primary_c
NEO_Previous_Segment_MRR__c
NEO_Subsequent_Segments_MRR_Additional__c
NEO_Override_ACV__c
Original_Subscription__c

Quote Fields:
SBQQ__Type__c
NEO_Contract_Type__c
NEO_Is_it_Power_Users__c
Amendment_Quote_Type__c
*/