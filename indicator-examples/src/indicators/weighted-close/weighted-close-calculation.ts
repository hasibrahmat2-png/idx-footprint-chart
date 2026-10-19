import {
	CandlestickData,
	LineData,
	UTCTimestamp,
	WhitespaceData,
} from 'lightweight-charts';

const DEFAULT_WEIGHT = 2;

export type SupportedData = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;

/**
 * Options for weighted close calculation.
 */
export interface WeightedCloseCalculationOptions {
	/**
	 * Offset to shift the result forward (positive) or backward (negative).
	 * E.g. offset=2 will display the weighted close bars ahead.
	 */
	offset?: number;
	/**
	 * Weight to apply to the close price. By default a weight of `2` is used.
	 */
	weight?: number;
}

/**
 * Calculates a weighted close (with optional offset and weight).
 *
 * For each item computes the weighted close value.
 *
 * @param {(CandlestickData | WhitespaceData)[]} data - The input data array (sorted by time).
 * @param {WeightedCloseCalculationOptions} options - Calculation options.
 * @returns {(LineData | WhitespaceData)[]} An array of values (or whitespace data).
 *
 * @example
 * const result = calculateWeightedCloseIndicatorValues(
 *   [{ time: 1, open: 10, high: 11, low: 9.9, close: 10.2 }, { time: 2, open: 10.2, high: 10.5, low: 9.9, close: 10.3 }],
 *   { length: 2 }
 * );
 */
export function calculateWeightedCloseIndicatorValues(
	data: (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[],
	options: WeightedCloseCalculationOptions
): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] {
	if (data.length === 0) {
		return [];
	}

	const weight = options.weight ?? DEFAULT_WEIGHT;
	const rawValues: (number | undefined)[] = data.map(item => {
		if (
			'close' in item &&
			typeof item.high === 'number' &&
			typeof item.low === 'number' &&
			typeof item.close === 'number'
		) {
			return ((item.close * weight) + item.high + item.low) / (2 + weight);
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
