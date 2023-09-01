// MVM
export function onAfterCalculate(quoteModel, quoteLineModels, conn) {
  return new Promise((resolve, reject) => {
    console.log("onAfterCalculate");

    calculateACV(quoteLineModels,quoteModel, conn);

    resolve("");
  });
}

// MVM
function calculateACV(quoteLineModels,quoteModel, conn){
  // MVM
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

    console.log("onAfterCalculate__QL_Details__quoteModel.record.Amendment_Quote_Type__c: ", quoteModel.record.Amendment_Quote_Type__c)

    // Now, for each group of quoteLines with the same SBQQ__SegmentKey__c
    segmentKeyGroups.forEach(async (quoteLinesGroup, segmentKey) => {
      console.log("onAfterCalculate__segmentKeyGroups.forEach()")
      
      let quoteAmendmentQuoteType = "";

      if (!quoteModel.record.Amendment_Quote_Type__c) {
        // console.log('onAfterCalculate__IsTypeMissing?: ', !quoteModel.record.Amendment_Quote_Type__c);
        // console.log('onAfterCalculate__quoteModel.record.Id: ', quoteModel.record.Id);
        
        try {

          const result = await conn.query(`SELECT Amendment_Quote_Type__c FROM SBQQ__Quote__c WHERE Id = '${quoteModel.record.Id}' AND Amendment_Quote_Type__c != ''`);
          
          if (result && result.records && result.records.length > 0) {

            quoteAmendmentQuoteType = result.records[0].Amendment_Quote_Type__c;
          }
        } catch (error) {
          console.error('onAfterCalculate__Error querying Amendment_Quote_Type__c:', error);
        }
      }
      
      console.log('onAfterCalculate__quoteAmendmentQuoteType: ', quoteAmendmentQuoteType);

      // Test one of the lines using the determineQuoteType function
      const quoteType = determineQuoteType(quoteLinesGroup[0].record, quoteAmendmentQuoteType);

      console.log("onAfterCalculate__segmentKeyGroups__quoteType: ", quoteType);

      // Based on the result, send all the lines to the appropriate calculateACV function
      switch (quoteType) {
        case "Net New":
          calculateNetNewACV(quoteLinesGroup);
          break;

        case "Amendment":
          calculateAmendmentACV(quoteLinesGroup);
          break;

        case "Renewal":
          calculateRenewalACV(quoteLinesGroup)
          break;

        case "Cancel And Renewal - REPLACEMENT":
          calculateCancelAndRenewalReplacementACV(quoteLinesGroup)
          break;
        
        case "Cancel And Renewal - CANCELATION":
          calculateCancelAndRenewalCancelationtACV(quoteLinesGroup)
          break;
        
        case "Unknown":
          console.error("Not Fir For ACV Calculation");
          break;

      }
    });
}

// MVM
function isLastYear(quoteLine, allQuoteLines) {
  console.log("isLastYear");

  if (!quoteLine || !allQuoteLines || allQuoteLines.length <= 1) {
    console.error('isLastYear__Invalid input to isLastYear: ', { quoteLine, allQuoteLines });
    return false;
  }

  const filteredLines = allQuoteLines.filter(line => line && line.SBQQ__SegmentKey__c === quoteLine.SBQQ__SegmentKey__c);

  // console.log('isLastYear__quoteLine: ', quoteLine);
  // console.log('isLastYear__allQuoteLines: ', quoteLine);
  // console.log('isLastYear__filteredLines: ', filteredLines);

  if (filteredLines.length === 0) {
    console.error('isLastYear__No matching lines found for segment key: ', quoteLine.SBQQ__SegmentKey__c);
    return false;
  }

  // console.log('isLastYear__filteredLines.length: ', filteredLines.length);
  // console.log('isLastYear__quoteLine.record.SBQQ__SegmentIndex__c: ', quoteLine.record.SBQQ__SegmentIndex__c);
  // console.log('isLastYear__quoteLine.record.NEO_Offset_Months__c: ', quoteLine.record.NEO_Offset_Months__c);

  return quoteLine.record.SBQQ__SegmentIndex__c === filteredLines.length && quoteLine.record.NEO_Offset_Months__c > 0;
}

// MVM 123
function determineQuoteType(quoteLine, quoteAmendmentQuoteType) {
  console.log("determineQuoteType");

  // console.log("determineQuoteType__SBQQ__RenewedSubscription__c", quoteLine.SBQQ__RenewedSubscription__c)
  // console.log("determineQuoteType__quoteLine.SBQQ__UpgradedSubscription__c", quoteLine.SBQQ__UpgradedSubscription__c)
  // console.log("determineQuoteType__quoteLine.Original_Subscription__c", quoteLine.Original_Subscription__c)
  // console.log("determineQuoteType__quoteAmendmentQuoteType", quoteAmendmentQuoteType)

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
  else if (!quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c && quoteAmendmentQuoteType === "Replacement Quote") {
    return "Cancel And Renewal - REPLACEMENT";
  }

  // Cancel And Renewal - CANCELATION scenario
  else if (!quoteLine.SBQQ__RenewedSubscription__c && !quoteLine.SBQQ__UpgradedSubscription__c && quoteLine.Original_Subscription__c && quoteAmendmentQuoteType === "Cancelled and Replaced Quote") {
    return "Cancel And Renewal - CANCELATION";
  }

  // Unknown scenario
  else {
    return "Unknown";
  }
}

// MVM
function calculateCancelAndRenewalCancelationtACV(quoteLines) {
  console.log("calculateCancelAndRenewalCancelationACV");

  try {
    for (const quoteLine of quoteLines) {
      quoteLine.record.NEO_Year_1_ACV__c = 0;
      quoteLine.record.NEO_Year_2_ACV__c = 0;
      quoteLine.record.NEO_Year_3_ACV__c = 0;
      quoteLine.record.NEO_Year_4_ACV__c = 0;
      quoteLine.record.NEO_Year_5_ACV__c = 0;
    }
  } catch (error) {
    console.error('calculateCancelAndRenewalCancelationACV__Error in calculateCancelAndRenewalCancelationACV:', error);
    throw new Error('calculateCancelAndRenewalCancelationACV__Error in calculateCancelAndRenewalCancelationACV: ' + error.message);
  }
}

// MVM
function calculateCancelAndRenewalReplacementACV(quoteLines) {
  console.log("calculateCancelAndRenewalReplacementACV");

  try {
    // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
    quoteLines.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);

    // Initialize a variable to store the cumulative ACV from previous segments
    let cumulativeACV = 0;

    for (const quoteLine of quoteLines) {
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;

      // Check for valid segmentIndex and quoteLine
      if (typeof segmentIndex !== 'number' || isNaN(segmentIndex)) {
        console.error("calculateCancelAndRenewalReplacementACV__Invalid segmentIndex for quoteLine:", quoteLine);
        continue; // Skip processing this quoteLine
      }

      if (segmentIndex === 1) {
        quoteLine.record.NEO_Year_1_ACV__c = (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * quoteLine.record.NEO_Offset_Months__c)
          - quoteLine.record.NEO_Subscription_ACV__c;

        cumulativeACV += quoteLine.record.NEO_Year_1_ACV__c;
      } else {
        const previousSegment = quoteLines[segmentIndex - 1];
        if (!previousSegment) {
          throw new Error(`calculateCancelAndRenewalReplacementACV__Previous segment is undefined for segmentIndex ${segmentIndex}`);
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

    if (isLastYear(lastSegment, quoteLines)) {
      const nextSegmentIndex = lastSegment.record.SBQQ__SegmentIndex__c + 1;

      if (nextSegmentIndex <= 5) {
        const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";
        lastSegment.record[fieldName] = (lastSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.record.SBQQ__Quantity__c) - lastSegment.record.NEO_Subscription_ACV__c - cumulativeACV;
      }
    }

  } catch (error) {
    console.error('calculateCancelAndRenewalReplacementACV__Error in calculateCancelAndRenewalReplacementACV:', error);
    throw new Error('calculateCancelAndRenewalReplacementACV__Error in calculateCancelAndRenewalReplacementACV: ' + error.message);
  }
}


// MVM
function calculateRenewalACV(quoteLines) {
  console.log("calculateRenewalACV");
  try {
    // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
    quoteLines.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);

    // Initialize a variable to store the cumulative ACV from previous segments
    let cumulativeACV = 0;

    for (const quoteLine of quoteLines) {
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;

      // Check for valid segmentIndex and quoteLine
      if (typeof segmentIndex !== 'number' || isNaN(segmentIndex)) {
        console.error("calculateRenewalACV__Invalid segmentIndex for quoteLine:", quoteLine);
        continue; // Skip processing this quoteLine
      }

      if (segmentIndex === 1) {
        quoteLine.record.NEO_Year_1_ACV__c = (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (quoteLine.record.NEO_Renewed_Quantity__c * quoteLine.record.NEO_Renewed_Monthly_Net_Unit_Price__c * quoteLine.record.NEO_Offset_Months__c)
          - quoteLine.record.NEO_Subscription_ACV__c;

        cumulativeACV += quoteLine.record.NEO_Year_1_ACV__c;
      } else {
        const previousSegment = quoteLines[segmentIndex - 1];
        if (!previousSegment) {
          throw new Error(`calculateRenewalACV__Previous segment is undefined for segmentIndex ${segmentIndex}`);
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

    if (isLastYear(lastSegment, quoteLines)) {
      const nextSegmentIndex = lastSegment.record.SBQQ__SegmentIndex__c + 1;

      if (nextSegmentIndex <= 5) {
        const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";
        lastSegment.record[fieldName] = (lastSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.record.SBQQ__Quantity__c) - lastSegment.record.NEO_Subscription_ACV__c - cumulativeACV;
      }
    }

  } catch (error) {
    console.error('calculateRenewalACV__Error in calculateRenewalACV:', error);
    throw new Error('calculateRenewalACV__Error in calculateRenewalACV: ' + error.message);
  }
}



// MVM
function calculateNetNewACV(quoteLines) {
  console.log("calculateNetNewACV");
  try {
    // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
    quoteLines.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);

    // Initialize a variable to store the cumulative ACV from previous segments
    let cumulativeACV = 0;

    for (const quoteLine of quoteLines) {
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;

      // console.log("calculateNetNewACV__segmentIndex:", segmentIndex);

      // Check for valid segmentIndex and quoteLine
      if (typeof segmentIndex !== 'number' || isNaN(segmentIndex)) {
        console.error("calculateNetNewACV__Invalid segmentIndex for quoteLine:", quoteLine);
        continue; // Skip processing this quoteLine
      }

      if (segmentIndex === 1) {

        quoteLine.record.NEO_Year_1_ACV__c = quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c);

        cumulativeACV += quoteLine.record.NEO_Year_1_ACV__c;
      } else {
        const previousSegment = quoteLines[segmentIndex - 2];

        if (!previousSegment) {
          throw new Error(`calculateNetNewACV__Previous segment is undefined for segmentIndex ${segmentIndex}`);
        }

        // console.log("calculateNetNewACV__segmentIndex != 1__previousSegment.record.NEO_Offset_Months__c: ", previousSegment.record.SBQQ__SegmentIndex__c)

        // console.log("calculateNetNewACV__segmentIndex != 1__quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c: ", quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__quoteLine.record.SBQQ__Quantity__c: ", quoteLine.record.SBQQ__Quantity__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__quoteLine.record.NEO_Offset_Months__c: ", quoteLine.record.NEO_Offset_Months__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__previousSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c: ", previousSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__previousSegment.record.SBQQ__Quantity__c: ", previousSegment.record.SBQQ__Quantity__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__previousSegment.record.NEO_Offset_Months__c: ", previousSegment.record.NEO_Offset_Months__c)
        // console.log("calculateNetNewACV__segmentIndex != 1__cumulativeACV: ", cumulativeACV)

        // Calculate the ACV for this segment
        const currentACV = 
            (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (previousSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * previousSegment.record.SBQQ__Quantity__c * previousSegment.record.NEO_Offset_Months__c)
          - cumulativeACV;

        // console.log("calculateNetNewACV__segmentIndex != 1__currentACV: ", currentACV)

        if (segmentIndex <= 5) {
          // Assign the calculated ACV to the appropriate field based on segmentIndex
          quoteLine.record["NEO_Year_" + segmentIndex + "_ACV__c"] = currentACV;
        }

        // Update the cumulativeACV
        cumulativeACV += currentACV;
      }
    }

    // console.log("calculateNetNewACV__[quoteLines.length]: ", quoteLines.length)

    const lastSegment = quoteLines[quoteLines.length - 1];  // Last item in the list

    // console.log("calculateNetNewACV__[quoteLines.length - 1]: ", quoteLines.length - 1)
    // console.log("calculateNetNewACV__lastSegment: ", lastSegment)

    if (isLastYear(lastSegment, quoteLines)) {

      const nextSegmentIndex = lastSegment.record.SBQQ__SegmentIndex__c + 1;

      // console.log("calculateNetNewACV__nextSegmentIndex: ", nextSegmentIndex)

      if (nextSegmentIndex <= 5) {
        const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";

        lastSegment.record[fieldName] = (lastSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.record.SBQQ__Quantity__c) - lastSegment.record.NEO_Subscription_ACV__c - cumulativeACV;
      }
    }

  } catch (error) {
    console.error('calculateNetNewACV__Error in calculateNetNewACV:', error);
    throw new Error('calculateNetNewACV__Error in calculateNetNewACV: ' + error.message);
  }
  
}


// MVM
function calculateAmendmentACV(quoteLines) {
  console.log("calculateAmendmentACV");
  try {
    // Sort quoteLines by SBQQ__SegmentIndex__c if not already sorted
    quoteLines.sort((a, b) => a.record.SBQQ__SegmentIndex__c - b.record.SBQQ__SegmentIndex__c);

    // Initialize a variable to store the cumulative ACV from previous segments
    let cumulativeACV = 0;

    for (const quoteLine of quoteLines) {
      const segmentIndex = quoteLine.record.SBQQ__SegmentIndex__c;

      // Check for valid segmentIndex and quoteLine
      if (typeof segmentIndex !== 'number' || isNaN(segmentIndex)) {
        console.error("calculateAmendmentACV__Invalid segmentIndex for quoteLine:", quoteLine);
        continue; // Skip processing this quoteLine
      }

      if (segmentIndex === 1) {

        quoteLine.record.NEO_Year_1_ACV__c = (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__Quantity__c * (12 - quoteLine.record.NEO_Offset_Months__c))
          + (quoteLine.record.NEO_Monthly_Net_Unit_Price_Primary__c * quoteLine.record.SBQQ__PriorQuantity__c * quoteLine.record.NEO_Offset_Months__c)
          - quoteLine.record.NEO_Subscription_ACV__c;

        cumulativeACV += quoteLine.record.NEO_Year_1_ACV__c;
      } else {
        const previousSegment = quoteLines[segmentIndex - 1];
        if (!previousSegment) {
          throw new Error(`calculateAmendmentACV__Previous segment is undefined for segmentIndex ${segmentIndex}`);
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

    // console.log("calculateAmendmentACV__[quoteLines.length]: ", quoteLines.length)
    // console.log("calculateAmendmentACV__lastSegment: ", lastSegment)
    // console.log("calculateAmendmentACV__isLastYear(lastSegment, quoteLines): ", isLastYear(lastSegment, quoteLines))
  
    if (isLastYear(lastSegment, quoteLines)) {

      const nextSegmentIndex = lastSegment.record.SBQQ__SegmentIndex__c + 1;

      // console.log("calculateAmendmentACV__nextSegmentIndex: ", nextSegmentIndex)

      if (nextSegmentIndex <= 5) {
        const fieldName = "NEO_Year_" + nextSegmentIndex + "_ACV__c";

        // console.log("calculateAmendmentACV__fieldName: ", fieldName)

        lastSegment.record[fieldName] = (lastSegment.record.NEO_Monthly_Net_Unit_Price_Primary__c * 12 * lastSegment.record.SBQQ__Quantity__c) - lastSegment.record.NEO_Subscription_ACV__c - cumulativeACV;
      }
    }

  } catch (error) {
    console.error('calculateAmendmentACV__Error in calculateAmendmentACV:', error);
    throw new Error('calculateAmendmentACV__Error in calculateAmendmentACV: ' + error.message);
  }
}