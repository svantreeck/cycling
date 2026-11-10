/**
 * Pure encoders/decoders for the Bluetooth Fitness Machine Service (FTMS)
 * and the Cycling Power Service (CPS). Kept free of Web Bluetooth so they can be unit-tested.
 */

export const FTMS_SERVICE = 0x1826;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const FTMS_FEATURE = 0x2acc;
export const CPS_SERVICE = 0x1818;
export const CPS_MEASUREMENT = 0x2a63;

export interface IndoorBikeData {
  speedKph?: number;
  avgSpeedKph?: number;
  cadence?: number;
  avgCadence?: number;
  distanceM?: number;
  resistance?: number;
  power?: number;
  avgPower?: number;
  heartRate?: number;
  elapsedSec?: number;
  remainingSec?: number;
}

/** Parse an Indoor Bike Data (0x2AD2) notification. */
export function parseIndoorBikeData(dv: DataView): IndoorBikeData {
  const flags = dv.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};
  const has = (bit: number) => (flags & (1 << bit)) !== 0;

  // bit0 "More Data": instantaneous speed is present when the bit is 0.
  if (!has(0)) {
    out.speedKph = dv.getUint16(o, true) / 100;
    o += 2;
  }
  if (has(1)) {
    out.avgSpeedKph = dv.getUint16(o, true) / 100;
    o += 2;
  }
  if (has(2)) {
    out.cadence = dv.getUint16(o, true) / 2;
    o += 2;
  }
  if (has(3)) {
    out.avgCadence = dv.getUint16(o, true) / 2;
    o += 2;
  }
  if (has(4)) {
    out.distanceM = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16);
    o += 3;
  }
  if (has(5)) {
    out.resistance = dv.getInt16(o, true);
    o += 2;
  }
  if (has(6)) {
    out.power = dv.getInt16(o, true);
    o += 2;
  }
  if (has(7)) {
    out.avgPower = dv.getInt16(o, true);
    o += 2;
  }
  if (has(8)) {
    o += 5; // total energy u16, energy/hour u16, energy/min u8
  }
  if (has(9)) {
    out.heartRate = dv.getUint8(o);
    o += 1;
  }
  if (has(10)) {
    o += 1; // metabolic equivalent
  }
  if (has(11)) {
    out.elapsedSec = dv.getUint16(o, true);
    o += 2;
  }
  if (has(12)) {
    out.remainingSec = dv.getUint16(o, true);
    o += 2;
  }
  return out;
}

// ---- Control point -------------------------------------------------------

export const OP_REQUEST_CONTROL = 0x00;
export const OP_RESET = 0x01;
export const OP_SET_TARGET_POWER = 0x05;
export const OP_START = 0x07;
export const OP_SET_SIMULATION = 0x11;
export const OP_RESPONSE = 0x80;

export const encodeRequestControl = () => new Uint8Array([OP_REQUEST_CONTROL]);
export const encodeStart = () => new Uint8Array([OP_START]);
export const encodeReset = () => new Uint8Array([OP_RESET]);

export function encodeSetTargetPower(watts: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, OP_SET_TARGET_POWER);
  buf.setInt16(1, Math.round(clamp(watts, 0, 2000)), true);
  return new Uint8Array(buf.buffer);
}

export interface SimulationParams {
  windMps?: number;
  gradePct?: number;
  crr?: number;
  cw?: number;
}

export function encodeSetSimulation({
  windMps = 0,
  gradePct = 0,
  crr = 0.004,
  cw = 0.51,
}: SimulationParams = {}): Uint8Array {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, OP_SET_SIMULATION);
  buf.setInt16(1, Math.round(windMps * 1000), true);
  buf.setInt16(3, Math.round(gradePct * 100), true);
  buf.setUint8(5, Math.round(crr * 10000));
  buf.setUint8(6, Math.round(cw * 100));
  return new Uint8Array(buf.buffer);
}

export interface ControlPointResponse {
  requestOp: number;
  result: number;
  success: boolean;
}

export function parseControlPointResponse(dv: DataView): ControlPointResponse | null {
  if (dv.byteLength < 3 || dv.getUint8(0) !== OP_RESPONSE) return null;
  const result = dv.getUint8(2);
  return { requestOp: dv.getUint8(1), result, success: result === 0x01 };
}

// ---- Cycling Power Measurement (fallback, read-only) ----------------------

export interface CyclingPowerMeasurement {
  power: number;
  crankRevs?: number;
  /** last crank event time in 1/1024 s */
  crankEventTime?: number;
}

export function parseCyclingPowerMeasurement(dv: DataView): CyclingPowerMeasurement {
  const flags = dv.getUint16(0, true);
  const power = dv.getInt16(2, true);
  let o = 4;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  if (has(0)) o += 1; // pedal power balance
  if (has(2)) o += 2; // accumulated torque
  if (has(4)) o += 6; // wheel revs u32 + last wheel event u16
  const out: CyclingPowerMeasurement = { power };
  if (has(5)) {
    out.crankRevs = dv.getUint16(o, true);
    out.crankEventTime = dv.getUint16(o + 2, true);
  }
  return out;
}

/** Derive cadence (rpm) from two consecutive crank measurements, handling u16 rollover. */
export function cadenceFromCrank(
  prev: { revs: number; time: number },
  cur: { revs: number; time: number },
): number | null {
  const dRevs = (cur.revs - prev.revs + 0x10000) % 0x10000;
  const dTime = (cur.time - prev.time + 0x10000) % 0x10000;
  if (dTime === 0) return null;
  return (dRevs / (dTime / 1024)) * 60;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
