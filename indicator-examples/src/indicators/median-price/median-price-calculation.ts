import {
	CandlestickData,
	LineData,
	UTCTimestamp,
	WhitespaceData,
} from 'lightweight-charts';

export type SupportedData = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;

/**
 * Options for median price calculation.
 */
export interface MedianPriceCalculationOptions {

	/**
	 * Offset to shift the result forward (positive) or backward (negative).
	 * E.g. offset=2 will display the average price bars ahead.
	 */
	offset?: number;
}

/**
 * Calculates a median price (with optional offset).
 *
 * The formula is:
 * medianPrice = (high + low) / 2
 *
 * @template TData - The type of the input data.
 * @param {TData[]} data - The input data array (sorted by time).
 * @param {MedianPriceCalculationOptions} options - Calculation options.
 * @returns {(LineData | WhitespaceData)[]} An array of values (or whitespace data).
 *
 * @example
 * const result = calculateMedianPriceIndicatorValues(
 *   [{ time: 1, open: 10, high: 11, low: 4, close: 9 }, { time: 2, open: 9, high: 12, low: 8, close: 10 }],
 * );
 */
export function calculateMedianPriceIndicatorValues(
	data: SupportedData[],
	options: MedianPriceCalculationOptions
): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] {
	if (data.length === 0) {
		return [];
	}

	const rawValues: (number | undefined)[] = data.map(item => {
		if ('close' in item && typeof item.high === 'number' && typeof item.low === 'number') {
			return (item.high + item.low) / 2;
		}
		return undefined;
	});

	let final: (number | undefined)[] = rawValues;
	const offset = options.offset ?? 0;
	if (offset !== 0) {
		if (offset > 0) {
			final = Array(offset)
				.fill(undefined)
				.concat(final.slice(0, final.length - offset));
		} else if (offset < 0) {
			final = final.slice(-offset).concat(Array(-offset).fill(undefined));
		}
	}

	return data.map((d, i) =>
		typeof final[i] === 'number'
			? { time: d.time, value: final[i] as number }
			: { time: d.time }
	);
}
