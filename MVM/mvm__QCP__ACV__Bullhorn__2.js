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

    quoteLineModels.forEach(quoteLine => {
      //filter out non-segmented products for all
      if (quoteLine.record.SBQQ__SegmentKey__c === '1692206669782') {
        console.log("mvm__Top__quoteLineID: ", quoteLine.record.Id);
        console.log("mvm__Top__NEO_Monthly_Net_Unit_Price_Primary__c: ", quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c);
      }
    });

    //Set up a map to work through segments, makes dealing with segments per line easier
    //These are split out in case future modifications need to be made on a per type basis
    const netNewSegmentMap = new Map();
    const amendmentRenewalSegmentMap = new Map();
    const overrideSegmentMap = new Map();

    //copy & pasted below code to first loop through & default override 
    //Loop quote lines and assign to map by segment key
    quoteLineModels.forEach(quoteLine => {
      //filter out non-segmented products for all
      if (quoteLine.record.SBQQ__SegmentKey__c != null) {
        if (!overrideSegmentMap.has(quoteLine.record.SBQQ__SegmentKey__c)) {
          overrideSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, []);
        }
        overrideSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
      }
    });
    if (overrideSegmentMap.size > 0) {
      overrideSegmentMap.forEach(overrideSegmentArray => {
        let previousQuoteLineOverride;
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
            netNewSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, []);
          }
          netNewSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
        }
        //Amendment map assign
        if (quoteLine.record.Original_Subscription__c != null || quoteLine.record.SBQQ__RenewedSubscription__c != null) {
          if (!amendmentRenewalSegmentMap.has(quoteLine.record.SBQQ__SegmentKey__c)) {
            amendmentRenewalSegmentMap.set(quoteLine.record.SBQQ__SegmentKey__c, []);
          }
          amendmentRenewalSegmentMap.get(quoteLine.record.SBQQ__SegmentKey__c).push(quoteLine);
        }
      }
    });
    //Run intiial hwm product quantity validation - we have to run this on all sides - net new, amendment, and renewal - but it will only run for what is populated on the quote
    //Run net new
    if (netNewSegmentMap.size > 0) {
      netNewSegmentMap.forEach(netNewSegmentArray => {
        let previousQuoteLine;
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
        let previousQuoteLine;
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

    // MVM
    console.log("onAfterCalculate__ACV-Start__quoteLineModels[0].SBQQ__Product__c: ", quoteLineModels[0].record.SBQQ__Product__c);

    // Create a map to group quoteLines by SBQQ__SegmentKey__c
    const segmentKeyGroups = new Map();

    // Loop through quoteLineModels and assign to segmentKeyGroups by SBQQ__SegmentKey__c
    quoteLineModels.forEach((quoteLine) => {
      const segmentKey = quoteLine.record.SBQQ__SegmentKey__c;
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;


      // Check if the quoteLine has a valid segmentKey and segmentIndex
      if (segmentKey != null && segmentIndex != null) {
        if (!segmentKeyGroups.has(segmentKey)) {
          segmentKeyGroups.set(segmentKey, []);
        }
        segmentKeyGroups.get(segmentKey).push(quoteLine);
      }
    });

    console.log("onAfterCalculate__segmentKeyGroups: ", segmentKeyGroups);

    // Now, for each group of quoteLines with the same SBQQ__SegmentKey__c
    segmentKeyGroups.forEach((quoteLinesGroup, segmentKey) => {
      console.log("onAfterCalculate__segmentKeyGroups__quoteLinesGroup[0].record, quoteModel.record: ", quoteLinesGroup[0].record, quoteModel.record);

      // Test one of the lines using the determineQuoteType function
      const quoteType = determineQuoteType(quoteLinesGroup[0].record, quoteModel.record);

      console.log("onAfterCalculate__segmentKeyGroups__quoteType: ", quoteType);

      // Based on the result, send all the lines to the appropriate calculateACV function
      switch (quoteType) {
        case "Net New":
          calculateNetNewACV(quoteLinesGroup);
          break;

        case "Amendment":
          calculateAmendmentACV(quoteLinesGroup);
          break;

        // ... [other cases for other QuoteTypes]
      }
    });

    resolve("");
  });
}

/**
 * MVM
 * Determines if a given QuoteLine record is the last year in its segment.
 * @param {Object} quoteLine - The QuoteLine record to evaluate.
 * @param {Array} allQuoteLines - All QuoteLine records (to determine the highest segment index).
 * @returns {boolean} - Returns true if the QuoteLine is the last year, otherwise false.
 */
function isLastYear(quoteLine, allQuoteLines) {
  if (!quoteLine || !allQuoteLines || allQuoteLines.length === 0) {
    console.error('Invalid input to isLastYear:', { quoteLine, allQuoteLines });
    return false;
  }

  const filteredLines = allQuoteLines.filter(line => line && line.SBQQ__SegmentKey__c === quoteLine.SBQQ__SegmentKey__c);

  if (filteredLines.length === 0) {
    console.error('No matching lines found for segment key:', quoteLine.SBQQ__SegmentKey__c);
    return false;
  }

  const maxSegmentIndex = Math.max(...filteredLines.map(line => line.SBQQ__SegmentIndex__c));

  return quoteLine.SBQQ__SegmentIndex__c === maxSegmentIndex && quoteLine.NEO_Offset_Months__c > 0;
}

// MVM 123
function determineQuoteType(quoteLine, quoteModel) {
  // Net New scenario
  if (!quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && !quoteLine.Original_Subscription__c) {
    return "Net New";
  }

  // Amendment scenario
  else if (!quoteLine.SBQQ__RenewedSubscription__c && quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c) {
    return "Amendment";
  }

  // Renewal scenario
  else if (quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c) {
    return "Renewal";
  }

  // Cancel And Renewal - REPLACEMENT scenario
  else if (!quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c && quoteModel.Amendment_Quote_Type__c === "Replacement Quote") {
    return "Cancel And Renewal - REPLACEMENT";
  }

  // Cancel And Renewal - CANCELATION scenario
  else if (!quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c && quoteModel.Amendment_Quote_Type__c === "Cancelled and Replaced Quote") {
    return "Cancel And Renewal - CANCELATION";
  }

  // Unknown scenario
  else {
    return "Unknown";
  }
}

// MVM
function calculateNetNewACV(quoteLines) {
  // Assuming quoteLines is a list of QuoteLine records with the same SBQQ__SegmentKey__c

  // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
  quoteLines.sort((a, b) => a.SBQQ__SegmentIndex__c - b.SBQQ__SegmentIndex__c);

  // Initialize a variable to store the cumulative ACV from previous segments
  let cumulativeACV = 0;

  for (const quoteLine of quoteLines) {
    const segmentIndex = quoteLine.SBQQ__SegmentIndex__c;
    if (segmentIndex === 1) {
      quoteLine.NEO_Year_1_ACV__c = quoteLine.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.SBQQ__Quantity__c * (12 - quoteLine.NEO_Offset_Months__c);
      cumulativeACV += quoteLine.NEO_Year_1_ACV__c;
    } else {
      // Calculate the ACV for this segment
      const currentACV = (quoteLine.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.SBQQ__Quantity__c * (12 - quoteLine.NEO_Offset_Months__c))
        + (quoteLines[segmentIndex - 1].NEO_Monthly_Net_Unit_Price_Primary__c * quoteLines[segmentIndex - 1].SBQQ__Quantity__c * quoteLines[segmentIndex - 1].NEO_Offset_Months__c)
        - cumulativeACV;

      if (nextSegmentIndex <= 5) {
        // Assign the calculated ACV to the appropriate field based on segmentIndex
        quoteLine["NEO_Year_" + segmentIndex + "_ACV__c"] = currentACV;
      }

      // Update the cumulativeACV
      cumulativeACV += currentACV;
    }
  }

  // Handle the last year logic if applicable
  const lastSegment = quoteLines[quoteLines.length - 1];  // Last item in the list
  if (isLastYear(lastSegment)) {
    const nextSegmentIndex = lastSegment.SBQQ__SegmentIndex__c + 1;

    if (nextSegmentIndex <= 5) {
      const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";
      lastSegment[fieldName] = (lastSegment.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.SBQQ__Quantity__c) - cumulativeACV;
    }
  }
}

// MVM
function calculateAmendmentACV(quoteLines) {
  try {
    // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
    quoteLines.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);

    // Initialize a variable to store the cumulative ACV from previous segments
    let cumulativeACV = 0;

    for (const quoteLine of quoteLines) {
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;

      console.log("calculateAmendmentACV__segmentIndex: ", segmentIndex);

      // Check for valid segmentIndex and quoteLine
      if (typeof segmentIndex !== 'number' || isNaN(segmentIndex)) {
        console.error("Invalid segmentIndex for quoteLine:", quoteLine);
        continue; // Skip processing this quoteLine
      }

      console.log("quoteLineID: ", quoteLine.record.Id);
      console.log("NEO_Monthly_Net_Unit_Price_Primary__c: ", quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c);
      console.log("SBQQ__Quantity__c: ", quoteLine.record.SBQQ__Quantity__c);
      console.log("SBQQ__PriorQuantity__c: ", quoteLine.record.SBQQ__PriorQuantity__c);
      console.log("NEO_Offset_Months__c: ", quoteLine.record.NEO_Offset_Months__c);
      console.log("NEO_Subscription_ACV__c: ", quoteLine.record.NEO_Subscription_ACV__c); 
      console.log("SBQQ__SegmentKey__c: ", quoteLine.record.SBQQ__SegmentKey__c);

      if (segmentIndex === 1) {

        quoteLine.record.NEO_Year_1_ACV__c = (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__PriorQuantity__c * quoteLine.record.NEO_Offset_Months__c)
          - quoteLine.record.NEO_Subscription_ACV__c;

        cumulativeACV += quoteLine.record.NEO_Year_1_ACV__c;
      } else {
        const previousSegment = quoteLines[segmentIndex - 1];
        if (!previousSegment) {
          throw new Error(`Previous segment is undefined for segmentIndex ${segmentIndex}`);
        }

        // Calculate the ACV for this segment
        const currentACV = (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (previousSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * previousSegment.record.SBQQ__Quantity__c * previousSegment.record.NEO_Offset_Months__c)
          - quoteLine.record.NEO_Subscription_ACV__c
          - cumulativeACV;

        if (segmentIndex <= 5) {
          // Assign the calculated ACV to the appropriate field based on segmentIndex
          quoteLine.record["NEO_Year_" + segmentIndex + "_ACV__c"] = currentACV;
        }

        // Update the cumulativeACV
        cumulativeACV += currentACV;
      }
    }

    const lastSegment = quoteLines[quoteLines.length - 1];  // Last item in the list
    console.log("lastSegment__amend: ", lastSegment);
    console.log("quoteLines.length - 1__amend: ", quoteLines.length - 1);
    if (isLastYear(lastSegment, quoteLines)) {
      const nextSegmentIndex = lastSegment.record.SBQQ__SegmentIndex__c + 1;
      // console.log("nextSegmentIndex__amend: ", nextSegmentIndex);

      if (nextSegmentIndex <= 5) {
        const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";
        lastSegment.record[fieldName] = (lastSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.record.SBQQ__Quantity__c) - lastSegment.record.NEO_Subscription_ACV__c - cumulativeACV;
      }
    }

  } catch (error) {
    console.error('MVM-Error in calculateAmendmentACV:', error);
    throw new Error('MVM-Error in calculateAmendmentACV: ' + error.message);
  }
}



//Return bool logic for HWR validation
function validateHWR(quoteModel, qlSegment, previousQuoteLine) {
  return (
    quoteModel.record.NEO_Contract_Type__c == "Standard" &&
    qlSegment.record.HWM_Product__c &&
    !quoteModel.record.NEO_Is_it_Power_Users__c &&
    qlSegment.record.SBQQ__Quantity__c != 0 &&
    previousQuoteLine.record.SBQQ__Quantity__c >
    qlSegment.record.SBQQ__Quantity__c
  );
}

function amendmentRenewalACV(quoteModel, segmentMap) {
  segmentMap.forEach((segmentArray) => {
    let counter = 0;
    let segmentPartial = 0;
    let previousQuoteLine;
    let previousAcv;
    segmentArray.forEach((qlSegment) => {
      counter++;
      //These are split out for readability of the calculation
      const mrr = qlSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c;
      const quantity = qlSegment.record.SBQQ__Quantity__c;
      const offsetMonths = qlSegment.record.NEO_Offset_Months__c;
      const acv = mrr * quantity * (12 - offsetMonths);
      //Future segment
      //This will hold the subsequent segment if possible
      const futureQuoteLine =
        counter < segmentArray.length ? segmentArray[counter] : null;
      const nextMRR =
        futureQuoteLine != null
          ? futureQuoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c
          : 0;
      const nextQuantity =
        futureQuoteLine != null ? futureQuoteLine.record.SBQQ__Quantity__c : 0;
      const nextOffset =
        futureQuoteLine != null
          ? futureQuoteLine.record.NEO_Offset_Months__c
          : 0;
      const nextACV = nextMRR * nextQuantity * nextOffset;
      //Previous segment
      const previousMRR =
        previousQuoteLine != null
          ? previousQuoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c
          : 0;
      const previousQuantity =
        previousQuoteLine != null
          ? previousQuoteLine.record.SBQQ__Quantity__c
          : 0;
      const previousOffset =
        previousQuoteLine != null
          ? previousQuoteLine.record.NEO_Offset_Months__c
          : 0;
      //Final ACV
      let finalACV = 0;
      //Specific math for segment 1
      if (qlSegment.record.SBQQ__SegmentIndex__c == 1) {
        segmentPartial =
          mrr *
          qlSegment.record.SBQQ__Quantity__c *
          (12 -
            offsetMonths -
            qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c) +
          qlSegment.record.NEO_Previous_Segment_MRR__c * offsetMonths +
          nextMRR * qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c;
        finalACV =
          mrr *
          quantity *
          (12 -
            offsetMonths -
            qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c) +
          qlSegment.record.NEO_Previous_Segment_MRR__c * offsetMonths +
          nextMRR *
          quantity *
          qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c -
          qlSegment.record.NEO_Subscription_ACV__c;
      }

      //we want to do a different ACV calc for renewal quote lines on years 2+
      if (
        qlSegment.record.SBQQ__SegmentIndex__c > 1 &&
        qlSegment.record.SBQQ__RenewedSubscription__c != null
      ) {
        //keeping this calc here for now, this variable isn't used anywhere though
        segmentPartial =
          previousMRR * previousQuantity * (12 - previousOffset) -
          mrr * quantity * offsetMonths;
        //same calc as other years, but leave out subscription ACV for years 2+
        finalACV = acv + nextACV - previousAcv;
      }

      //if quote line is amended quote line, used for years 2+ (amended quote line = both upgraded subscription and original subscription are populated)
      if (
        qlSegment.record.SBQQ__SegmentIndex__c > 1 &&
        qlSegment.record.Original_Subscription__c != null &&
        qlSegment.record.SBQQ__UpgradedSubscription__c != null
      ) {
        //keeping this calc here for now, this variable isn't used anywhere though
        segmentPartial =
          previousMRR * previousQuantity * (12 - previousOffset) -
          mrr * quantity * offsetMonths;
        //calc for this year's ACV if it is an amended quote line:
        finalACV =
          acv +
          nextACV -
          previousAcv -
          qlSegment.record.NEO_Subscription_ACV__c;
      }

      //if quote line is a replacement quote line from cancel and replace package, only separating this out so we can add different calc if need be
      if (
        qlSegment.record.SBQQ__SegmentIndex__c > 1 &&
        qlSegment.record.Original_Subscription__c != null &&
        qlSegment.record.SBQQ__UpgradedSubscription__c == null
      ) {
        //same calc as amendment quote line ACV
        finalACV =
          acv +
          nextACV -
          previousAcv -
          qlSegment.record.NEO_Subscription_ACV__c;
      }

      //If the effective quantity is 0 (amended line with no change) set the acv to 0
      if (
        (qlSegment.record.SBQQ__UpgradedSubscription__c != null &&
          qlSegment.record.SBQQ__EffectiveQuantity__c == 0) ||
        quoteModel.record.Amendment_Quote_Type__c ==
        "Cancelled and Replaced Quote"
      ) {
        finalACV = 0;
      }

      previousAcv = finalACV;
      log(
        "segment",
        qlSegment.record.SBQQ__SegmentIndex__c,
        "cmrr",
        mrr,
        "cquant",
        quantity,
        "coffset",
        offsetMonths,
        "cacv",
        acv,
        "cSSMRA",
        qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c,
        "fmrr",
        nextMRR,
        "foffset",
        nextOffset,
        "facv",
        nextACV,
        "pmrr",
        previousMRR,
        "pquant",
        previousQuantity,
        "poffset",
        previousOffset,
        "segmentPartial",
        segmentPartial,
        "final acv",
        finalACV,
        "Amend Type",
        quoteModel.record.Amendment_Quote_Type__c,
        "Prev ACV",
        previousAcv
      );

      // setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c, finalACV);

      previousQuoteLine = qlSegment;
    });
  });
}

function inheritValuesFromFirstSegment(segmentMap) {
  segmentMap.forEach((segmentArray) => {
    // Identify the first segment
    const firstSegment = segmentArray[0];
    // Set values on subsequent segments based on the first segment
    segmentArray.slice(1).forEach((qlSegment) => {
      qlSegment.record.NEO_Offset_Months__c =
        firstSegment.record.NEO_Offset_Months__c;
      qlSegment.record.NEO_Subsequent_Segments_MRR_Additional__c =
        firstSegment.record.NEO_Subsequent_Segments_MRR_Additional__c;
    });
  });
}
//I copy & pasted the above function in order to call the override default at a different point in the calc
function inheritOverrideFromFirstSegment(segmentMap) {
  segmentMap.forEach((segmentArray) => {
    // Identify the first segment
    const firstSegment = segmentArray[0];
    // Set override acv on subsequent segments based on the first segment
    segmentArray.slice(1).forEach((qlSegment) => {
      qlSegment.record.NEO_Override_ACV__c =
        firstSegment.record.NEO_Override_ACV__c;
    });
  });
}

function netNewACV(segmentMap) {
  segmentMap.forEach((segmentArray) => {
    //Sort based on segment index - asc
    let previousQuoteLine;
    let runningACVTotal = 0;
    segmentArray.forEach((qlSegment) => {
      //These are split out for readability of the calculation
      const mrr = qlSegment.record.NEO_Total_Monthly_Net_Unit_Price__c;
      const subscriptionACV = qlSegment.record.NEO_Subscription_ACV__c;
      const replaceSubACV =
        subscriptionACV != null ? qlSegment.record.NEO_Subscription_ACV__c : 0;
      const subscriptionTerm = qlSegment.effectiveSubscriptionTerm;
      const offsetMonths = qlSegment.record.NEO_Offset_Months__c;
      let acv = mrr * (subscriptionTerm - offsetMonths) - replaceSubACV;
      log("initial ACV: ", qlSegment.record.SBQQ__SegmentIndex__c, acv);
      //For index 2 and beyond we need to rely on the previously calculated line
      if (previousQuoteLine != null) {
        const previousMRR =
          previousQuoteLine.record.NEO_Total_Monthly_Net_Unit_Price__c;
        //Add in the carryover from previous year
        console.log(
          "previousMRR * offset",
          qlSegment.record.SBQQ__SegmentIndex__c,
          previousMRR * offsetMonths
        );
        acv += previousMRR * offsetMonths;
        console.log(
          "post addition",
          qlSegment.record.SBQQ__SegmentIndex__c,
          acv
        );
        //Subtract current total
        acv -= runningACVTotal;
      }
      if (previousQuoteLine == null) {
        acv - replaceSubACV;
      }
      //Close out ACV calculation
      //Add total to running total
      runningACVTotal += acv;
      log("runningACV", runningACVTotal);
      log("final ACV: ", qlSegment.record.SBQQ__SegmentIndex__c, acv);
      //Since this is field specific instead of a generic field, this passes to this function to just assign the correct field with the correct info
      // setACVOnLine(qlSegment, qlSegment.record.SBQQ__SegmentIndex__c, acv);
      //Check to make sure that the array is greater than 1 to see if we even need to bother with the stub
      if (qlSegment.record.SBQQ__SegmentIndex__c == segmentArray.length) {
        const stubACV =
          mrr * 12 - runningACVTotal != 0 ? mrr * 12 - runningACVTotal : null;
        // setACVOnLine(
        //   qlSegment,
        //   qlSegment.record.SBQQ__SegmentIndex__c + 1,
        //   stubACV
        // );
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