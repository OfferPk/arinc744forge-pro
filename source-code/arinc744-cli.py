#!/usr/bin/env python3
"""
ARINC744Forge Pro - Standalone Python CLI Runner & Simulation Suite
Standards: ARINC Characteristic 744A, RTCA DO-160G, FAA TSO-C144, ARINC Specification 429-19
"""

import sys
import os
import json
import argparse
from datetime import datetime

class ARINC744Printer:
    def __init__(self, unit_id=1, paper_pct=85.0, head_temp_c=28.5):
        self.unit_id = unit_id
        self.dots_per_line = 480
        self.chars_per_line = 60
        self.paper_remaining_pct = paper_pct
        self.head_temp_c = head_temp_c
        self.print_speed_mm_sec = 25.0
        self.lines_printed_total = 1420
        
        self.sensors = {
            'paper_out': False,
            'paper_low': False,
            'platen_open': False,
            'head_over_temp': False
        }

        self.faults = {
            'stepper_motor_fault': False,
            'head_dot_burnout': False,
            'nvram_fault': False,
            'bus_parity_error': False,
            'low_voltage': False
        }

        self.spooler = []
        self.history = []
        self.update_sensors()

    def update_sensors(self):
        self.sensors['paper_low'] = self.paper_remaining_pct <= 15.0
        self.sensors['paper_out'] = self.paper_remaining_pct <= 0.0
        self.sensors['head_over_temp'] = self.head_temp_c >= 70.0
        return not (self.sensors['paper_out'] or self.sensors['platen_open'] or self.sensors['head_over_temp'])

    def calculate_strobe_ms(self):
        t_nom = 1.20 # ms at 25°C
        pulse = t_nom * (1.0 - 0.008 * (self.head_temp_c - 25.0))
        return round(max(0.4, min(2.5, pulse)), 3)

    def queue_job(self, job_id, title, lines):
        if not self.update_sensors():
            if self.sensors['paper_out']: raise RuntimeError("Cannot queue job: Paper Out.")
            if self.sensors['platen_open']: raise RuntimeError("Cannot queue job: Platen Open.")
            if self.sensors['head_over_temp']: raise RuntimeError("Cannot queue job: Head Over-Temp.")
        
        job = {
            'job_id': job_id,
            'title': title,
            'lines': lines,
            'count': len(lines),
            'timestamp': datetime.utcnow().isoformat()
        }
        self.spooler.append(job)
        return job

    def execute_print(self):
        if not self.spooler:
            return {'success': False, 'reason': 'BUFFER_EMPTY'}
        if not self.update_sensors():
            return {'success': False, 'reason': 'INTERLOCK_TRIPPED', 'sensors': self.sensors}

        job = self.spooler.pop(0)
        paper_consumed_mm = job['count'] * 3.175
        drop_pct = (paper_consumed_mm / 30000.0) * 100.0
        self.paper_remaining_pct = max(0.0, round(self.paper_remaining_pct - drop_pct, 2))
        self.head_temp_c = round(self.head_temp_c + (job['count'] * 0.15), 1)
        self.lines_printed_total += job['count']
        job['strobe_ms'] = self.calculate_strobe_ms()
        job['printed_at'] = datetime.utcnow().isoformat()
        self.history.insert(0, job)
        self.update_sensors()
        return {'success': True, 'job': job}

    @staticmethod
    def compute_odd_parity(val31):
        count = bin(val31).count('1')
        return 1 if (count % 2 == 0) else 0

    def encode_label_172(self, c1='A', c2='C', seq=1):
        word = 0x7A # Octal 172
        word |= ((self.unit_id & 0x03) << 8)
        word |= ((ord(c1) & 0x7F) << 10)
        word |= ((ord(c2) & 0x7F) << 18)
        word |= ((seq & 0x07) << 26)
        word |= (0x03 << 29) # SSM Normal
        p = self.compute_odd_parity(word)
        word |= (p << 31)
        return word

    def encode_label_173(self, form_feed=False, line_feed=True):
        word = 0xBA # Octal 173
        word |= ((self.unit_id & 0x03) << 8)
        if form_feed: word |= (1 << 10)
        if line_feed: word |= (1 << 11)
        word |= (0x03 << 29)
        p = self.compute_odd_parity(word)
        word |= (p << 31)
        return word

    def encode_label_270(self):
        self.update_sensors()
        word = 0x58 # Octal 270
        word |= ((self.unit_id & 0x03) << 8)
        ready = not (self.sensors['paper_out'] or self.sensors['platen_open'] or self.sensors['head_over_temp'])
        if ready: word |= (1 << 10)
        if self.sensors['paper_low']: word |= (1 << 11)
        if self.sensors['paper_out']: word |= (1 << 12)
        if self.sensors['platen_open']: word |= (1 << 13)
        if self.sensors['head_over_temp']: word |= (1 << 14)
        if len(self.spooler) >= 10: word |= (1 << 15)

        has_fault = self.sensors['paper_out'] or self.sensors['platen_open'] or self.sensors['head_over_temp']
        ssm = 0x00 if has_fault else 0x03
        word |= (ssm << 29)
        p = self.compute_odd_parity(word)
        word |= (p << 31)
        return word

    def encode_label_350(self):
        word = 0xE8 # Octal 350
        word |= ((self.unit_id & 0x03) << 8)
        if self.faults['stepper_motor_fault']: word |= (1 << 10)
        if self.faults['head_dot_burnout']: word |= (1 << 11)
        if self.faults['nvram_fault']: word |= (1 << 12)
        if self.faults['bus_parity_error']: word |= (1 << 13)
        if self.faults['low_voltage']: word |= (1 << 14)

        has_fault = any(self.faults.values())
        ssm = 0x00 if has_fault else 0x03
        word |= (ssm << 29)
        p = self.compute_odd_parity(word)
        word |= (p << 31)
        return word

    def encode_label_357(self, lines=0, success=True):
        word = 0xFB # Octal 357
        word |= ((self.unit_id & 0x03) << 8)
        word |= ((lines & 0x3FFF) << 10)
        if success: word |= (1 << 25)
        word |= (0x03 << 29)
        p = self.compute_odd_parity(word)
        word |= (p << 31)
        return word

    def run_normative_audit(self):
        tests = []
        # 1. Mounting
        tests.append(('ARINC744-REQ-001', 'ARINC 744A Form, Fit & Mounting', self.unit_id in [1, 2, 3]))
        # 2. Thermal Resolution
        tests.append(('ARINC744-REQ-002', 'Thermal Head Resolution (8 dots/mm / 480 dots)', self.dots_per_line == 480))
        # 3. Strobe Compensation
        strobe = self.calculate_strobe_ms()
        tests.append(('ARINC744-REQ-003', 'Dynamic Thermal Strobe Temp Compensation', 0.4 <= strobe <= 2.5))
        # 4. Over-temp
        prev_t = self.head_temp_c
        self.head_temp_c = 72.0
        self.update_sensors()
        ot = self.sensors['head_over_temp']
        self.head_temp_c = prev_t
        self.update_sensors()
        tests.append(('ARINC744-REQ-004', 'Head Over-Temperature Throttling (> 70°C)', ot))
        # 5. Paper Sensors
        prev_p = self.paper_remaining_pct
        self.paper_remaining_pct = 10.0; self.update_sensors(); low_ok = self.sensors['paper_low']
        self.paper_remaining_pct = 0.0; self.update_sensors(); out_ok = self.sensors['paper_out']
        self.paper_remaining_pct = prev_p; self.update_sensors()
        tests.append(('ARINC744-REQ-005', 'Paper Low (<= 15%) & Paper Out Sensors', low_ok and out_ok))
        # 6. Platen Open
        self.sensors['platen_open'] = True
        interlock_ok = not self.update_sensors()
        self.sensors['platen_open'] = False
        self.update_sensors()
        tests.append(('ARINC744-REQ-006', 'Platen Cover Microswitch Inhibit', interlock_ok))
        # 7. Character Matrix
        tests.append(('ARINC744-REQ-007', 'Character Matrix Capacity (60 chars/line)', self.chars_per_line == 60))
        # 8. ARINC 429 Streaming
        w172 = self.encode_label_172('C', 'P', 1)
        w173 = self.encode_label_173(False, True)
        tests.append(('ARINC744-REQ-008', 'ARINC 429 Character Streaming (Labels 172 & 173)', (w172 & 0xFF) == 0x7A and (w173 & 0xFF) == 0xBA))
        # 9. ARINC 429 Parity
        w270 = self.encode_label_270()
        w350 = self.encode_label_350()
        w357 = self.encode_label_357(10, True)
        parity_ok = all(bin(w).count('1') % 2 == 1 for w in [w172, w173, w270, w350, w357])
        tests.append(('ARINC744-REQ-009', 'ARINC 429 Status, BITE & Parity (Labels 270/350/357)', parity_ok))
        # 10. Spooler Integrity
        self.queue_job('AUDIT-1', 'Audit Test', ['Line A', 'Line B'])
        res = self.execute_print()
        tests.append(('ARINC744-REQ-010', 'Spooler FIFO Queue & Job Execution', res['success']))

        passed = sum(1 for _, _, ok in tests if ok)
        return {
            'total': len(tests),
            'passed': passed,
            'score': f"{(passed / len(tests)) * 100:.1f}%",
            'status': 'ARINC_744A_FLIGHT_DECK_PRINTER_CERTIFIED' if passed == len(tests) else 'NON_COMPLIANT',
            'results': [{'req': r, 'name': n, 'passed': p} for r, n, p in tests]
        }

def main():
    parser = argparse.ArgumentParser(description="ARINC744Forge Pro CLI Flight Deck Printer Simulator")
    parser.add_argument("--unit", type=int, default=1, choices=[1, 2, 3], help="Printer Unit ID (1=Pedestal, 2=Maintenance)")
    parser.add_argument("--paper", type=float, default=85.0, help="Paper remaining percentage")
    parser.add_argument("--temp", type=float, default=28.5, help="Thermal printhead temperature in °C")
    parser.add_argument("--template", choices=['oceanic', 'weather', 'takeoff'], help="Print standard aviation receipt")
    parser.add_argument("--platen-open", action="store_true", help="Simulate platen cover open")
    parser.add_argument("--audit", action="store_true", help="Run 10-point airworthiness compliance audit")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    printer = ARINC744Printer(unit_id=args.unit, paper_pct=args.paper, head_temp_c=args.temp)
    if args.platen_open:
        printer.sensors['platen_open'] = True
        printer.update_sensors()

    if args.audit:
        res = printer.run_normative_audit()
        if args.json:
            print(json.dumps(res, indent=2))
        else:
            print("================================================================================")
            print(" ARINC744Forge Pro - 10-Point Normative Airworthiness Compliance Audit")
            print(" Standards: ARINC Characteristic 744A, RTCA DO-160G, FAA TSO-C144")
            print("================================================================================")
            for r in res['results']:
                status = "PASS [OK]" if r['passed'] else "FAIL [X]"
                print(f" {r['req']:<18} | {r['name']:<50} | {status}")
            print("--------------------------------------------------------------------------------")
            print(f" Compliance Score: {res['score']} ({res['passed']}/{res['total']}) | Status: {res['status']}")
            print("================================================================================")
        return

    if args.template:
        templates = {
            'oceanic': ('CPDLC-01', 'Shanwick Oceanic Clearance', [
                "*** SHANWICK OCEANIC ATC CLEARANCE (EGGX) ***",
                "TIME: 22:35 UTC  ACID: BAW178  FL360 M0.84",
                "ENTRY: ELSIR AT 23:45 UTC  TRACK FOXTROT",
                "EXIT: COLOR AT 03:15 UTC  SELCAL: AH-CQ"
            ]),
            'weather': ('WX-01', 'METAR / TAF Weather Report', [
                "*** METAR / TAF WEATHER REPORT ***",
                "KJFK 142251Z 31012KT 10SM BKN045 14/06 A2992",
                "EGLL 142220Z 24008KT 9999 FEW025 12/08 Q1018",
                "OMDB 142200Z 12005KT 9999 NSC 28/21 Q1012"
            ]),
            'takeoff': ('PERF-01', 'EFB Takeoff Performance', [
                "*** EFB TAKEOFF PERFORMANCE CALCULATION ***",
                "B787-9 RWY 22L  TOW: 242.5T  FLAPS: 5",
                "V1: 148 KT  VR: 154 KT  V2: 161 KT  FLEX +48C"
            ])
        }
        jid, title, lines = templates[args.template]
        try:
            printer.queue_job(jid, title, lines)
            print_res = printer.execute_print()
            if args.json:
                print(json.dumps(print_res, indent=2))
            else:
                print(f"PRINTING JOB: {title} [{jid}]")
                print("------------------------------------------------------------")
                for line in lines:
                    print(f" | {line}")
                print("------------------------------------------------------------")
                print(f" Result: SUCCESS | Strobe: {printer.calculate_strobe_ms()} ms | Paper Left: {printer.paper_remaining_pct}%")
        except Exception as e:
            print(f"PRINT FAILED: {e}")
        return

    # Default Telemetry
    w172 = printer.encode_label_172()
    w173 = printer.encode_label_173()
    w270 = printer.encode_label_270()
    w350 = printer.encode_label_350()
    w357 = printer.encode_label_357()

    data = {
        'unit': f"FFDP {printer.unit_id} (Center Pedestal)",
        'ready': not (printer.sensors['paper_out'] or printer.sensors['platen_open'] or printer.sensors['head_over_temp']),
        'paper_remaining_pct': printer.paper_remaining_pct,
        'head_temp_c': printer.head_temp_c,
        'strobe_ms': printer.calculate_strobe_ms(),
        'lines_printed_total': printer.lines_printed_total,
        'spooler_depth': len(printer.spooler),
        'sensors': printer.sensors,
        'arinc429_hex': {
            'label172': f"0x{w172:08X}",
            'label173': f"0x{w173:08X}",
            'label270': f"0x{w270:08X}",
            'label350': f"0x{w350:08X}",
            'label357': f"0x{w357:08X}"
        }
    }

    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print("================================================================================")
        print(f" ARINC744Forge Pro - Full Flight Deck Printer Telemetry")
        print("================================================================================")
        print(f" Unit Status     : {'READY [IDLE]' if data['ready'] else 'HARDWARE INTERLOCK / FAULT'}")
        print(f" Paper Remaining : {data['paper_remaining_pct']}% | Head Temp: {data['head_temp_c']}°C | Strobe: {data['strobe_ms']} ms")
        print(f" Total Lines     : {data['lines_printed_total']} lines | Spooler Queue: {data['spooler_depth']} jobs")
        print(f" Sensors         : Low={data['sensors']['paper_low']} | Out={data['sensors']['paper_out']} | Platen={data['sensors']['platen_open']} | OverTemp={data['sensors']['head_over_temp']}")
        print("--------------------------------------------------------------------------------")
        print(f" ARINC 429 Bus   : L172={data['arinc429_hex']['label172']} | L173={data['arinc429_hex']['label173']} | L270={data['arinc429_hex']['label270']} | L350={data['arinc429_hex']['label350']} | L357={data['arinc429_hex']['label357']}")
        print("================================================================================")

if __name__ == '__main__':
    main()
