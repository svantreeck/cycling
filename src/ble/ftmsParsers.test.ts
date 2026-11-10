import {
  cadenceFromCrank,
  encodeSetSimulation,
  encodeSetTargetPower,
  parseControlPointResponse,
  parseCyclingPowerMeasurement,
  parseIndoorBikeData,
} from './ftmsParsers';

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('parseIndoorBikeData', () => {
  it('parses speed + cadence + power (typical KICKR Core payload)', () => {
    // flags 0x0044: bit2 cadence, bit6 power; bit0=0 so speed present
    // speed 3250 (32.50 km/h) = 0x0CB2, cadence 180 (90rpm) = 0x00B4, power 250 = 0x00FA
    const d = parseIndoorBikeData(dv([0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xfa, 0x00]));
    expect(d).toEqual({ speedKph: 32.5, cadence: 90, power: 250 });
  });

  it('parses power only when More Data bit set (no speed)', () => {
    // flags 0x0041: bit0 (no speed), bit6 power
    const d = parseIndoorBikeData(dv([0x41, 0x00, 0x2c, 0x01]));
    expect(d).toEqual({ power: 300 });
  });

  it('skips distance, resistance, energy and reads heart rate', () => {
    // flags: bit2 cadence, bit4 distance, bit5 resistance, bit6 power, bit8 energy, bit9 HR
    const flags = (1 << 2) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 8) | (1 << 9);
    const bytes = [
      flags & 0xff, flags >> 8,
      0x10, 0x27, // speed 10000 → 100 km/h
      0xa0, 0x00, // cadence 160 → 80 rpm
      0x01, 0x02, 0x03, // distance 0x030201
      0x05, 0x00, // resistance 5
      0xc8, 0x00, // power 200
      0, 0, 0, 0, 0, // energy
      0x8c, // HR 140
    ];
    const d = parseIndoorBikeData(dv(bytes));
    expect(d).toEqual({
      speedKph: 100,
      cadence: 80,
      distanceM: 0x030201,
      resistance: 5,
      power: 200,
      heartRate: 140,
    });
  });
});

describe('control point encoders', () => {
  it('encodes Set Target Power 250 W as 05 FA 00', () => {
    expect([...encodeSetTargetPower(250)]).toEqual([0x05, 0xfa, 0x00]);
  });

  it('clamps negative power to zero', () => {
    expect([...encodeSetTargetPower(-10)]).toEqual([0x05, 0x00, 0x00]);
  });

  it('encodes flat simulation', () => {
    // wind 0, grade 0, crr 40 (0.004), cw 51 (0.51)
    expect([...encodeSetSimulation()]).toEqual([0x11, 0, 0, 0, 0, 40, 51]);
  });

  it('encodes negative grade', () => {
    // -2.5% → -250 → 0xFF06
    expect([...encodeSetSimulation({ gradePct: -2.5 })].slice(3, 5)).toEqual([0x06, 0xff]);
  });

  it('parses control point response', () => {
    expect(parseControlPointResponse(dv([0x80, 0x05, 0x01]))).toEqual({
      requestOp: 5,
      result: 1,
      success: true,
    });
    expect(parseControlPointResponse(dv([0x80, 0x05, 0x05]))?.success).toBe(false);
    expect(parseControlPointResponse(dv([0x05, 0x05]))).toBeNull();
  });
});

describe('cycling power fallback', () => {
  it('parses power and crank data', () => {
    // flags bit5 crank data
    const m = parseCyclingPowerMeasurement(dv([0x20, 0x00, 0xfa, 0x00, 0x0a, 0x00, 0x00, 0x04]));
    expect(m).toEqual({ power: 250, crankRevs: 10, crankEventTime: 1024 });
  });

  it('computes cadence across u16 rollover', () => {
    // 1 rev in 0.5 s = 120 rpm, wrapping time counter
    expect(cadenceFromCrank({ revs: 0xffff, time: 0xff00 }, { revs: 0, time: 0x0100 })).toBe(120);
  });
});
