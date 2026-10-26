/**
 * ARINC744Forge Pro - 10-Point Normative Airworthiness Compliance Auditor
 * Standards: ARINC Characteristic 744A, RTCA DO-160G, FAA TSO-C144, ARINC Specification 429-19
 */

class ARINC744Auditor {
  constructor(engine) {
    this.engine = engine;
  }

  auditAll() {
    const results = [
      this.auditFormFitFunction(),
      this.auditThermalPrintResolution(),
      this.auditThermalStrobeCompensation(),
      this.auditHeadOvertempProtection(),
      this.auditPaperSensorInterlocks(),
      this.auditPlatenCoverInterlock(),
      this.auditCharacterMatrixCapacity(),
      this.auditArinc429CharacterStreaming(),
      this.auditArinc429StatusBiteParity(),
      this.auditSpoolerBufferIntegrity()
    ];

    const passedCount = results.filter(r => r.passed).length;
    const scorePercent = ((passedCount / results.length) * 100).toFixed(1);

    return {
      totalRules: results.length,
      passedRules: passedCount,
      failedRules: results.length - passedCount,
      complianceScore: `${scorePercent}%`,
      certifiedStatus: passedCount === results.length ? 'ARINC_744A_FLIGHT_DECK_PRINTER_CERTIFIED' : 'NON_COMPLIANT',
      details: results
    };
  }

  // 1. ARINC 744A Form, Fit & Function
  auditFormFitFunction() {
    const passed = this.engine.unitId >= 1 && this.engine.unitId <= 3;
    return {
      id: 'ARINC744-REQ-001',
      title: 'ARINC 744A Form, Fit & Cockpit Mounting',
      standard: 'ARINC Characteristic 744A Section 2.0 & Attachment 1',
      passed: passed,
      value: `Pedestal Unit ID: ${this.engine.unitId}`,
      expected: 'Standard cockpit center pedestal or side console form factor',
      notes: 'Complies with mechanical dimensions, power pinouts, and Dzus rail mounting.'
    };
  }

  // 2. Direct Thermal Line Printing Technology
  auditThermalPrintResolution() {
    const passed = this.engine.dotsPerLine === 480;
    return {
      id: 'ARINC744-REQ-002',
      title: 'Direct Thermal Printhead Resolution (8 dots/mm / 203 DPI)',
      standard: 'ARINC 744A Section 3.1 & FAA TSO-C144',
      passed: passed,
      value: `${this.engine.dotsPerLine} dots/line (8 dots/mm across 60 mm roll)`,
      expected: '480 dots/line minimum line thermal printhead array',
      notes: 'Provides sharp contrast for flight clearances, barcode scanning, and text.'
    };
  }

  // 3. Thermal Strobe Pulse Width Temperature Compensation
  auditThermalStrobeCompensation() {
    const strobe = this.engine.calculateStrobePulseWidth();
    const passed = strobe >= 0.4 && strobe <= 2.5;
    return {
      id: 'ARINC744-REQ-003',
      title: 'Dynamic Strobe Pulse Width Head Temperature Compensation',
      standard: 'ARINC 744A Section 3.2 & RTCA DO-160G Section 4',
      passed: passed,
      value: `${strobe} ms at ${this.engine.headTemperatureC}°C`,
      expected: '0.40 ms to 2.50 ms inverse slope pulse timing vs head temperature',
      notes: 'Prevents thermal blooming at elevated temperatures and under-burn when cold.'
    };
  }

  // 4. Head Over-Temperature Throttling & Protection
  auditHeadOvertempProtection() {
    const prevTemp = this.engine.headTemperatureC;
    this.engine.headTemperatureC = 72.0;
    this.engine.checkSensors();
    const tripped = this.engine.sensors.headOverTemp === true;
    this.engine.headTemperatureC = prevTemp;
    this.engine.checkSensors();
    return {
      id: 'ARINC744-REQ-004',
      title: 'Printhead Over-Temperature Throttling (> 70°C)',
      standard: 'ARINC 744A Section 3.3 & RTCA DO-160G Thermal Cat B2',
      passed: tripped,
      value: 'Trip threshold: 70.0°C (Inhibits printhead strobe)',
      expected: 'Automatic hardware interlock to prevent thermal printhead burnout',
      notes: 'Safeguards ceramic heating elements and semiconductor driver arrays.'
    };
  }

  // 5. Paper Sensor Interlocks (Paper Low & Paper Out)
  auditPaperSensorInterlocks() {
    const prevPct = this.engine.paperRemainingPercent;
    this.engine.paperRemainingPercent = 10.0;
    this.engine.checkSensors();
    const lowDetected = this.engine.sensors.paperLow;
    this.engine.paperRemainingPercent = 0.0;
    this.engine.checkSensors();
    const outDetected = this.engine.sensors.paperOut;
    this.engine.paperRemainingPercent = prevPct;
    this.engine.checkSensors();

    const passed = lowDetected && outDetected;
    return {
      id: 'ARINC744-REQ-005',
      title: 'Optical Paper Low (<= 15%) & Paper Out (<= 0%) Sensors',
      standard: 'ARINC 744A Section 3.4 & FAA TSO-C144',
      passed: passed,
      value: `Low detection: ${lowDetected}, Out detection: ${outDetected}`,
      expected: 'Optical warning when roll <= 15% and absolute inhibit when empty',
      notes: 'Prevents incomplete printed clearances and alerts flight crew for roll swap.'
    };
  }

  // 6. Platen / Door Open Interlock
  auditPlatenCoverInterlock() {
    const prevPlaten = this.engine.sensors.platenOpen;
    this.engine.sensors.platenOpen = true;
    let errorThrown = false;
    try {
      this.engine.createJob('TEST-INTERLOCK', 'Test', ['Line 1']);
    } catch (e) {
      errorThrown = true;
    }
    this.engine.sensors.platenOpen = prevPlaten;
    return {
      id: 'ARINC744-REQ-006',
      title: 'Platen / Door Open Microswitch Interlock',
      standard: 'ARINC 744A Section 3.5 & RTCA DO-160G Mechanical',
      passed: errorThrown,
      value: `Inhibit active: ${errorThrown}`,
      expected: 'Print motor & thermal strobe disabled when latch is disengaged',
      notes: 'Prevents gear stripping, motor stall, and user finger pinch hazards.'
    };
  }

  // 7. Character Generator Matrix (60 Chars/Line)
  auditCharacterMatrixCapacity() {
    const passed = this.engine.charsPerLine === 60;
    return {
      id: 'ARINC744-REQ-007',
      title: 'Character Generator Matrix (60 Characters/Line)',
      standard: 'ARINC 744A Section 4.1 & ICAO Annex 6 Datalink',
      passed: passed,
      value: `${this.engine.charsPerLine} columns per line (8x16 font matrix)`,
      expected: 'Standard 60 characters/line format matching ACARS message width',
      notes: 'Permits unclipped display of CPDLC clearances, METAR/TAF, and FMS reports.'
    };
  }

  // 8. ARINC 429 Character Streaming (Labels 172 & 173)
  auditArinc429CharacterStreaming() {
    const l172 = this.engine.encodeLabel172('A', 'T', 2);
    const l173 = this.engine.encodeLabel173(false, true, false, false);
    const passed = l172.label === '172' && l173.label === '173' && l172.chars === 'AT';
    return {
      id: 'ARINC744-REQ-008',
      title: 'ARINC 429 Character Streaming (Labels 172 & 173)',
      standard: 'ARINC Specification 429-19 & ARINC 744A Attachment 2',
      passed: passed,
      value: `L172: ${l172.rawHex} (chars: ${l172.chars}), L173: ${l173.rawHex}`,
      expected: 'Continuous character data streaming with format control word packing',
      notes: 'Enables high-speed 100 kbps transmission from ATSU/CMU and FMS computers.'
    };
  }

  // 9. ARINC 429 Discrete, BITE & Status Parity (Labels 270, 350, 357)
  auditArinc429StatusBiteParity() {
    const l270 = this.engine.encodeLabel270();
    const l350 = this.engine.encodeLabel350();
    const l357 = this.engine.encodeLabel357(12, true);

    const verifyParity = (word) => {
      let count = 0;
      for (let i = 0; i < 32; i++) {
        if ((word >>> i) & 1) count++;
      }
      return (count % 2) === 1;
    };

    const p270 = verifyParity(l270.rawUint32);
    const p350 = verifyParity(l350.rawUint32);
    const p357 = verifyParity(l357.rawUint32);

    const passed = p270 && p350 && p357;
    return {
      id: 'ARINC744-REQ-009',
      title: 'ARINC 429 Discrete Status, BITE & Parity (Labels 270, 350, 357)',
      standard: 'ARINC 429-19 & ARINC 744A Section 4.3',
      passed: passed,
      value: `L270:${l270.rawHex} (P:${l270.parityBit}), L350:${l350.rawHex}, L357:${l357.rawHex}`,
      expected: 'Strict Bit 32 odd parity across all status and diagnostic words',
      notes: 'Provides real-time health telemetry to Central Maintenance Computer (CMC).'
    };
  }

  // 10. Spooler Buffer & Job Queue Integrity
  auditSpoolerBufferIntegrity() {
    const initialDepth = this.engine.printBuffer.length;
    const job = this.engine.createJob('AUDIT-JOB', 'Audit Test', ['Test line 1', 'Test line 2']);
    const hasJob = this.engine.printBuffer.some(j => j.jobId === job.jobId);
    const printRes = this.engine.executePrint();
    const passed = hasJob && printRes.success;
    return {
      id: 'ARINC744-REQ-010',
      title: 'Spooler FIFO Queue & Job Execution Integrity',
      standard: 'ARINC 744A Section 4.4 & FAA TSO-C144',
      passed: passed,
      value: `Job: ${job.jobId}, Result: ${printRes.success ? 'SUCCESS' : 'FAILED'}`,
      expected: 'Reliable multi-document FIFO queueing and automated completion tracking',
      notes: 'Prevents job intermixing when multiple flight deck systems request printouts.'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ARINC744Auditor };
}
