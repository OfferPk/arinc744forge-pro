#!/usr/bin/env python3
"""
ARINC744Forge Pro - Automated Test Runner & Verification Suite
10 Comprehensive Verification Tests for ARINC 744A / RTCA DO-160G Compliance
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader
cli_module = SourceFileLoader("arinc744_cli", os.path.join(os.path.dirname(__file__), "arinc744-cli.py")).load_module()
ARINC744Printer = cli_module.ARINC744Printer

class TestARINC744ForgePro(unittest.TestCase):
    def setUp(self):
        self.printer = ARINC744Printer(unit_id=1, paper_pct=85.0, head_temp_c=25.0)

    # Test 1: Resolution & Column Capacity
    def test_01_resolution_and_columns(self):
        self.assertEqual(self.printer.dots_per_line, 480, "Must have 480 dots per line (8 dots/mm)")
        self.assertEqual(self.printer.chars_per_line, 60, "Must support 60 characters per line")

    # Test 2: Dynamic Strobe Pulse Width
    def test_02_strobe_pulse_width(self):
        # At 25°C, strobe = 1.20 ms
        self.printer.head_temp_c = 25.0
        self.assertEqual(self.printer.calculate_strobe_ms(), 1.20)
        # At 50°C, strobe = 1.2 * (1 - 0.008 * 25) = 1.2 * 0.8 = 0.96 ms
        self.printer.head_temp_c = 50.0
        self.assertEqual(self.printer.calculate_strobe_ms(), 0.96)
        # At 0°C, strobe = 1.2 * (1 - 0.008 * (-25)) = 1.2 * 1.2 = 1.44 ms
        self.printer.head_temp_c = 0.0
        self.assertEqual(self.printer.calculate_strobe_ms(), 1.44)

    # Test 3: Head Over-Temperature Alarm Trip
    def test_03_head_overtemp_alarm(self):
        self.printer.head_temp_c = 65.0
        self.assertFalse(self.printer.sensors['head_over_temp'])
        self.printer.head_temp_c = 72.0
        self.printer.update_sensors()
        self.assertTrue(self.printer.sensors['head_over_temp'])
        # Verify BITE word reports fault
        w270 = self.printer.encode_label_270()
        bit15_ot = (w270 >> 14) & 1
        self.assertEqual(bit15_ot, 1, "Label 270 Bit 15 must be 1 on head over-temp")

    # Test 4: Paper Low Sensor
    def test_04_paper_low_sensor(self):
        self.printer.paper_remaining_pct = 20.0
        self.printer.update_sensors()
        self.assertFalse(self.printer.sensors['paper_low'])
        self.printer.paper_remaining_pct = 12.0
        self.printer.update_sensors()
        self.assertTrue(self.printer.sensors['paper_low'])

    # Test 5: Paper Out Sensor & Inhibit
    def test_05_paper_out_sensor(self):
        self.printer.paper_remaining_pct = 0.0
        self.printer.update_sensors()
        self.assertTrue(self.printer.sensors['paper_out'])
        # Attempting to queue print job must raise RuntimeError
        with self.assertRaises(RuntimeError):
            self.printer.queue_job('JOB-FAIL', 'Test', ['Sample Line'])

    # Test 6: Platen Open Microswitch Interlock
    def test_06_platen_open_interlock(self):
        self.printer.sensors['platen_open'] = True
        self.assertFalse(self.printer.update_sensors())
        with self.assertRaises(RuntimeError):
            self.printer.queue_job('JOB-FAIL-2', 'Test', ['Sample Line'])
        self.printer.sensors['platen_open'] = False
        self.assertTrue(self.printer.update_sensors())

    # Test 7: Spooler Queue Execution & Paper Kinematics
    def test_07_spooler_and_paper_consumption(self):
        initial_paper = self.printer.paper_remaining_pct
        initial_lines = self.printer.lines_printed_total
        test_lines = ["Line 1", "Line 2", "Line 3", "Line 4"]
        job = self.printer.queue_job('JOB-01', 'Test Document', test_lines)
        self.assertEqual(len(self.printer.spooler), 1)
        res = self.printer.execute_print()
        self.assertTrue(res['success'])
        self.assertEqual(self.printer.lines_printed_total, initial_lines + 4)
        self.assertLess(self.printer.paper_remaining_pct, initial_paper)
        self.assertEqual(len(self.printer.spooler), 0)

    # Test 8: ARINC 429 Character Packing (Label 172)
    def test_08_arinc429_char_packing(self):
        w172 = self.printer.encode_label_172('A', 'Z', 3)
        # Check label octal 172
        self.assertEqual(w172 & 0xFF, 0x7A)
        # Check Char 1 'A' (ASCII 65)
        c1 = (w172 >> 10) & 0x7F
        self.assertEqual(c1, ord('A'))
        # Check Char 2 'Z' (ASCII 90)
        c2 = (w172 >> 18) & 0x7F
        self.assertEqual(c2, ord('Z'))
        # Check Seq Num
        seq = (w172 >> 26) & 0x07
        self.assertEqual(seq, 3)

    # Test 9: ARINC 429 Bit 32 Odd Parity Verification
    def test_09_arinc429_bit32_odd_parity(self):
        words = [
            self.printer.encode_label_172('N', 'O', 1),
            self.printer.encode_label_173(False, True),
            self.printer.encode_label_270(),
            self.printer.encode_label_350(),
            self.printer.encode_label_357(25, True)
        ]
        for w in words:
            ones = bin(w).count('1')
            self.assertEqual(ones % 2, 1, f"Word 0x{w:08X} has {ones} ones; must have odd parity (odd count)")

    # Test 10: 10-Point Normative Airworthiness Compliance Audit
    def test_10_normative_compliance_audit(self):
        audit = self.printer.run_normative_audit()
        self.assertEqual(audit['total'], 10, "Total audit rules must equal 10")
        self.assertEqual(audit['passed'], 10, "All 10 audit rules must pass")
        self.assertEqual(audit['score'], "100.0%", "Compliance score must be 100.0%")
        self.assertEqual(audit['status'], "ARINC_744A_FLIGHT_DECK_PRINTER_CERTIFIED")

if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromTestCase(TestARINC744ForgePro)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
    print("\nALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY.")
