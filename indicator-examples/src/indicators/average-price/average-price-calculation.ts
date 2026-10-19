import {
	CandlestickData,
	LineData,
	Time,
	WhitespaceData,
} from 'lightweight-charts';

export type SupportedData = CandlestickData | WhitespaceData;

/**
 * Options for average price calculation.
 */
export interface AveragePriceCalculationOptions {
	/**
	 * Offset to shift the result forward (positive) or backward (negative).
	 * E.g. offset=2 will display the average price bars ahead.
	 */
	offset?: number;
}

/**
 * Calculates a average price (with optional offset).
 *
 * For each item computes the OHLC/4 value.
 *
 * @param {(CandlestickData | WhitespaceData)[]} data - The input data array (sorted by time).
 * @param {AveragePriceCalculationOptions} options - Calculation options.
 * @returns {(LineData | WhitespaceData)[]} An array of values (or whitespace data).
 *
 * @example
 * const result = calculateAveragePriceIndicatorValues(
 *   [{ time: 1, open: 10, high: 11, low: 9.9, close: 10.2 }, { time: 2, open: 10.2, high: 10.5, low: 9.9, close: 10.3 }],
 *   { length: 2 }
 * );
 */
export function calculateAveragePriceIndicatorValues<T = Time>(
	data: (CandlestickData<T> | WhitespaceData<T>)[],
	options: AveragePriceCalculationOptions
): (LineData<T> | WhitespaceData<T>)[] {
	if (data.length === 0) {
		return [];
	}

	const rawValues: (number | undefined)[] = data.map(item => {
		if (
			'close' in item &&
			typeof item.open === 'number' &&
			typeof item.high === 'number' &&
			typeof item.low === 'number' &&
			typeof item.close === 'number'
		) {
			return (item.open + item.high + item.low + item.close) / 4;
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
