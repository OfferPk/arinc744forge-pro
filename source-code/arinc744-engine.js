/**
 * ARINC744Forge Pro - Core Full Flight Deck Printer (FFDP) Engine
 * Standards: ARINC Characteristic 744A, RTCA DO-160G, FAA TSO-C144, ARINC Specification 429-19
 * 
 * Provides:
 * - Direct thermal line printhead simulation (8 dots/mm, 203.2 DPI, 480 dots/line, 60 chars/line)
 * - Thermal strobe pulse timing & temperature compensation (0°C to +75°C)
 * - Sensor state machine: Paper Out, Paper Low, Platen Open, Head Over-Temp, Cutter
 * - ARINC 429 bus serialization (Labels 172, 173, 270, 350, 357) with Bit 32 odd parity
 * - Aviation document templates: CPDLC Oceanic Clearance, METAR/TAF Weather, Takeoff Performance
 * - Spooler FIFO memory queue with line-by-line rasterization
 */

class ARINC744Engine {
  constructor(options = {}) {
    this.unitId = options.unitId || 1; // 1=Center Pedestal, 2=Maintenance/Aux
    this.dotsPerLine = options.dotsPerLine || 480; // 60 mm roll @ 8 dots/mm = 480 dots
    this.charsPerLine = options.charsPerLine || 60; // 8x16 font matrix
    this.headTemperatureC = options.headTemperatureC || 28.5; // °C
    this.printSpeedMmSec = options.printSpeedMmSec || 25.0; // mm/sec
    this.paperRemainingPercent = options.paperRemainingPercent || 85.0; // %
    
    // Hardware Sensors
    this.sensors = {
      paperOut: false,
      paperLow: false,
      platenOpen: false,
      headOverTemp: false,
      bufferFull: false
    };

    // BITE Faults
    this.faults = {
      stepperMotorFault: false,
      headDotBurnout: false,
      nvramFault: false,
      busParityError: false,
      lowVoltage: false
    };

    // Spooler & Print Buffer
    this.printBuffer = [];
    this.currentJob = null;
    this.historyJobs = [];
    this.isPrinting = false;
    this.linesPrintedTotal = 1420;

    this.checkSensors();
  }

  // --- Sensor & Health Evaluation ---

  checkSensors() {
    this.sensors.paperLow = this.paperRemainingPercent <= 15.0;
    this.sensors.paperOut = this.paperRemainingPercent <= 0.0;
    this.sensors.headOverTemp = this.headTemperatureC >= 70.0;
    
    // If paper out or platen open or head over temp, cannot print
    return {
      ready: !this.sensors.paperOut && !this.sensors.platenOpen && !this.sensors.headOverTemp,
      sensors: { ...this.sensors },
      faults: { ...this.faults }
    };
  }

  /**
   * Calculates thermal strobe pulse width (ms) based on head temperature:
   * t_strobe(T) = t_nominal * (1.0 - 0.008 * (T - 25.0))
   */
  calculateStrobePulseWidth() {
    const tNominalMs = 1.20; // 1.2 ms nominal at 25°C
    const pulseWidth = tNominalMs * (1.0 - 0.008 * (this.headTemperatureC - 25.0));
    return parseFloat(Math.max(0.4, Math.min(2.5, pulseWidth)).toFixed(3));
  }

  // --- Print Job Management ---

  createJob(jobId, title, contentLines, attributes = {}) {
    this.checkSensors();
    if (this.sensors.paperOut) {
      throw new Error("Cannot queue print job: Paper Out sensor active.");
    }
    if (this.sensors.platenOpen) {
      throw new Error("Cannot queue print job: Platen cover is open.");
    }

    const job = {
      jobId: jobId || `PRT-${Date.now().toString().slice(-4)}`,
      title: title || 'Aviation Print Job',
      lines: contentLines || [],
      lineCount: contentLines ? contentLines.length : 0,
      timestamp: new Date().toISOString(),
      attributes: {
        doubleHeight: attributes.doubleHeight || false,
        doubleWidth: attributes.doubleWidth || false,
        inverted: attributes.inverted || false,
        font: attributes.font || 'STANDARD_8x16'
      },
      status: 'QUEUED'
    };

    this.printBuffer.push(job);
    return job;
  }

  executePrint() {
    this.checkSensors();
    if (this.printBuffer.length === 0) {
      return { success: false, reason: 'BUFFER_EMPTY' };
    }
    if (this.sensors.paperOut || this.sensors.platenOpen || this.sensors.headOverTemp) {
      return { success: false, reason: 'HARDWARE_INTERLOCK_FAULT', sensors: this.sensors };
    }

    const job = this.printBuffer.shift();
    this.currentJob = job;
    job.status = 'PRINTING';

    // Simulate paper consumption (approx 3.0 mm per text line)
    const paperConsumedMm = job.lineCount * 3.175; // 1/8 inch line pitch
    const percentDrop = (paperConsumedMm / 30000.0) * 100.0; // 30m standard roll
    this.paperRemainingPercent = Math.max(0.0, parseFloat((this.paperRemainingPercent - percentDrop).toFixed(2)));
    
    // Simulate slight head temperature rise (+0.2°C per line)
    this.headTemperatureC = parseFloat((this.headTemperatureC + (job.lineCount * 0.15)).toFixed(1));

    this.linesPrintedTotal += job.lineCount;
    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    job.strobeMs = this.calculateStrobePulseWidth();

    this.historyJobs.unshift(job);
    if (this.historyJobs.length > 20) this.historyJobs.pop();

    this.checkSensors();
    return {
      success: true,
      job: job,
      paperRemaining: `${this.paperRemainingPercent}%`,
      headTemp: `${this.headTemperatureC}°C`,
      strobeWidthMs: job.strobeMs
    };
  }

  // --- ARINC 429 Bus Protocol Serialization ---

  /**
   * Computes Bit 32 Odd Parity for 32-bit ARINC 429 word
   */
  static computeOddParity(val31) {
    let count = 0;
    for (let i = 0; i < 31; i++) {
      if ((val31 >>> i) & 1) count++;
    }
    return (count % 2 === 0) ? 1 : 0;
  }

  /**
   * Encodes ARINC 429 Label 172: Character Data Transfer Word
   * Packed ASCII (2 to 3 characters per word)
   */
  encodeLabel172(char1 = 'A', char2 = 'C', seqNum = 1) {
    let word = 0x7A; // Octal 172 reversed bitwise = 0x7A
    const sdi = (this.unitId & 0x03);
    word |= (sdi << 8);

    const c1 = char1.charCodeAt(0) & 0x7F;
    const c2 = char2.charCodeAt(0) & 0x7F;
    const seq = (seqNum & 0x07);

    word |= (c1 << 10);
    word |= (c2 << 18);
    word |= (seq << 26);

    // SSM: Normal Operation (11)
    word |= (0x03 << 29);

    const parity = ARINC744Engine.computeOddParity(word);
    word |= (parity << 31);

    return {
      label: '172',
      labelOctal: '172',
      description: 'Printer Character Data Transfer',
      rawHex: '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      rawUint32: word >>> 0,
      parityBit: parity,
      chars: `${char1}${char2}`,
      seqNum: seqNum
    };
  }

  /**
   * Encodes ARINC 429 Label 173: Display / Print Format Control Word
   */
  encodeLabel173(formFeed = false, lineFeed = true, doubleHeight = false, inverted = false) {
    let word = 0xBA; // Octal 173 reversed = 0xBA
    const sdi = (this.unitId & 0x03);
    word |= (sdi << 8);

    if (formFeed) word |= (1 << 10);     // Bit 11: Form Feed (Eject/Tear)
    if (lineFeed) word |= (1 << 11);     // Bit 12: Line Feed
    if (doubleHeight) word |= (1 << 12); // Bit 13: Double Height Font
    if (inverted) word |= (1 << 13);     // Bit 14: Inverted Print (White on Black)
    
    // SSM: Normal Operation (11)
    word |= (0x03 << 29);

    const parity = ARINC744Engine.computeOddParity(word);
    word |= (parity << 31);

    return {
      label: '173',
      labelOctal: '173',
      description: 'Print Format Control Word',
      rawHex: '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      rawUint32: word >>> 0,
      parityBit: parity,
      formFeed: formFeed,
      lineFeed: lineFeed
    };
  }

  /**
   * Encodes ARINC 429 Label 270: Printer Discrete Status Word
   */
  encodeLabel270() {
    this.checkSensors();
    let word = 0x58; // Octal 270 reversed = 0x58
    const sdi = (this.unitId & 0x03);
    word |= (sdi << 8);

    const isReady = !this.sensors.paperOut && !this.sensors.platenOpen && !this.sensors.headOverTemp;

    if (isReady) word |= (1 << 10);                   // Bit 11: Printer Ready
    if (this.sensors.paperLow) word |= (1 << 11);     // Bit 12: Paper Low
    if (this.sensors.paperOut) word |= (1 << 12);     // Bit 13: Paper Out
    if (this.sensors.platenOpen) word |= (1 << 13);   // Bit 14: Platen Open
    if (this.sensors.headOverTemp) word |= (1 << 14); // Bit 15: Head Over-Temp
    if (this.printBuffer.length >= 10) word |= (1 << 15); // Bit 16: Buffer Full

    // SSM: 00 = Failure Warning if paper out or platen open, else 11 = Normal
    const hasFault = this.sensors.paperOut || this.sensors.platenOpen || this.sensors.headOverTemp;
    const ssm = hasFault ? 0x00 : 0x03;
    word |= (ssm << 29);

    const parity = ARINC744Engine.computeOddParity(word);
    word |= (parity << 31);

    return {
      label: '270',
      labelOctal: '270',
      description: 'Printer Discrete Status Word',
      rawHex: '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      rawUint32: word >>> 0,
      parityBit: parity,
      ready: isReady,
      ssmStatus: hasFault ? 'Failure Warning (00)' : 'Normal Operation (11)'
    };
  }

  /**
   * Encodes ARINC 429 Label 350: Printer BITE Fault Word
   */
  encodeLabel350() {
    let word = 0xE8; // Octal 350 reversed = 0xE8
    const sdi = (this.unitId & 0x03);
    word |= (sdi << 8);

    if (this.faults.stepperMotorFault) word |= (1 << 10);
    if (this.faults.headDotBurnout) word |= (1 << 11);
    if (this.faults.nvramFault) word |= (1 << 12);
    if (this.faults.busParityError) word |= (1 << 13);
    if (this.faults.lowVoltage) word |= (1 << 14);

    const hasInternalFault = Object.values(this.faults).some(f => f === true);
    const ssm = hasInternalFault ? 0x00 : 0x03;
    word |= (ssm << 29);

    const parity = ARINC744Engine.computeOddParity(word);
    word |= (parity << 31);

    return {
      label: '350',
      labelOctal: '350',
      description: 'Printer BITE & Fault Word',
      rawHex: '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      rawUint32: word >>> 0,
      parityBit: parity,
      hasFault: hasInternalFault,
      ssmStatus: hasInternalFault ? 'Failure Warning (00)' : 'Normal Operation (11)'
    };
  }

  /**
   * Encodes ARINC 429 Label 357: Print Job Status / Acknowledgement Word
   */
  encodeLabel357(linesPrinted = 0, success = true) {
    let word = 0xFB; // Octal 357 reversed = 0xFB
    const sdi = (this.unitId & 0x03);
    word |= (sdi << 8);

    const count = Math.min(0x3FFF, linesPrinted);
    word |= (count << 10); // Bits 11-24: Line count
    if (success) word |= (1 << 25); // Bit 26: Success status

    word |= (0x03 << 29); // SSM Normal
    const parity = ARINC744Engine.computeOddParity(word);
    word |= (parity << 31);

    return {
      label: '357',
      labelOctal: '357',
      description: 'Print Job Status / Ack Word',
      rawHex: '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      rawUint32: word >>> 0,
      parityBit: parity,
      linesPrinted: linesPrinted,
      success: success
    };
  }

  // --- Aviation Templates ---

  static getOceanicClearanceTemplate() {
    return [
      "------------------------------------------------------------",
      "*** SHANWICK OCEANIC ATC CLEARANCE (EGGX) ***",
      "------------------------------------------------------------",
      "TIME: 22:35 UTC   DATE: 15-OCT-2026",
      "ACID: BAW178      ICAO: 40058A",
      "ROUTE: NAT TRACK FOXTROT",
      "ENTRY: ELSIR AT 23:45 UTC",
      "MAINTAIN: FL360   MACH: M0.84",
      "EXIT: COLOR AT 03:15 UTC",
      "CROSSING CLEARANCE ISSUED VIA CPDLC / ACARS",
      "SELCAL CHECK: AH-CQ (SATVOICE PRIORITY)",
      "------------------------------------------------------------",
      "*** PILOT ACKNOWLEDGEMENT REQUIRED VIA FMS ***"
    ];
  }

  static getWeatherReportTemplate() {
    return [
      "------------------------------------------------------------",
      "*** METAR / TAF WEATHER REPORT ***",
      "------------------------------------------------------------",
      "KJFK 142251Z 31012KT 10SM BKN045 OVC090 14/06 A2992 RMK AO2",
      "EGLL 142220Z 24008KT 9999 FEW025 BKN040 12/08 Q1018 NOSIG",
      "OMDB 142200Z 12005KT 9999 NSC 28/21 Q1012 NOSIG",
      "------------------------------------------------------------",
      "SIGMET: NIL IN SECTOR FOXTROT",
      "ALTIMETER CHECK: CROSS-CHECK R / L BARO SETTINGS"
    ];
  }

  static getTakeoffPerformanceTemplate() {
    return [
      "------------------------------------------------------------",
      "*** EFB TAKEOFF PERFORMANCE CALCULATION ***",
      "------------------------------------------------------------",
      "AIRCRAFT: B787-9    RWY: 22L (DRY 11,351 FT)",
      "TOW: 242,500 KG     ZFW: 181,200 KG     CG: 24.2%",
      "FLAPS: 5            THRUST: D-TO 1 (FLEX +48C)",
      "------------------------------------------------------------",
      "V1:  148 KT         VR: 154 KT          V2: 161 KT",
      "STAB TRIM: 4.8 UP   PACKS: AUTO         A/I: OFF",
      "ACCEL HT: 1000 FT   EO ACCEL HT: 800 FT",
      "------------------------------------------------------------",
      "VERIFIED BY: CAPT / FO EFB SIGN-OFF"
    ];
  }

  getTelemetry() {
    const status = this.checkSensors();
    const l172 = this.encodeLabel172('C', 'L', 1);
    const l173 = this.encodeLabel173(false, true, false, false);
    const l270 = this.encodeLabel270();
    const l350 = this.encodeLabel350();
    const l357 = this.encodeLabel357(this.currentJob ? this.currentJob.lineCount : 0, true);

    return {
      unitId: `FFDP ${this.unitId} (Pedestal)`,
      status: status.ready ? 'READY' : (this.sensors.paperOut ? 'PAPER_OUT' : (this.sensors.platenOpen ? 'PLATEN_OPEN' : 'OVERTEMP')),
      paperRemainingPercent: this.paperRemainingPercent,
      paperRemainingMm: (this.paperRemainingPercent * 300).toFixed(0),
      headTemperatureC: this.headTemperatureC,
      strobePulseWidthMs: this.calculateStrobePulseWidth(),
      linesPrintedTotal: this.linesPrintedTotal,
      printBufferDepth: this.printBuffer.length,
      sensors: this.sensors,
      faults: this.faults,
      arinc429: {
        label172: l172,
        label173: l173,
        label270: l270,
        label350: l350,
        label357: l357
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ARINC744Engine };
}
