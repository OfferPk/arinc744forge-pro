# ARINC Characteristic 744A Full Flight Deck Printer Specification

## 1\. Scope & System Definition

ARINC Characteristic 744A specifies the standard form, fit, electrical interfaces, and operational characteristics of the airborne Full Flight Deck Printer (FFDP). The printer is mounted in the cockpit center pedestal or side console across modern commercial transport aircraft (Airbus A320/A330/A350/A380, Boeing 777/787, Embraer E-Jets), providing flight crews with immediate physical records of ATC clearances, weather advisories, performance calculations, and maintenance reports.

## 2\. Thermal Printhead Characteristics

- **Printhead Technology**: Thick-film line thermal printhead array.  
- **Resolution**: 8 dots/mm (203.2 DPI).  
- **Line Width**: 480 dots/line across a 60 mm roll (58 mm effective print width) or 640/832 dots/line across an 80 mm roll.  
- **Character Matrix**: Standard 60 characters/line format utilizing an 8x16 dot font matrix; double-height (8x32) and double-width (16x16) font modes supported.  
- **Thermal Strobe Timing**: \$\$t\_{strobe}(T) \= t\_{nominal} \\times (1.0 \- 0.008 \\times (T \- 25.0))\$\$ where \$t\_{nominal} \= 1.20\\text{ ms}\$ at 25°C.  
- **Thermal Protection**: Printhead temperature monitored continuously. If \$T\_{head} \> 70.0^\\circ\\text{C}\$, thermal throttling trips, inhibiting strobe pulses until temperature cools below 60.0°C.

## 3\. Sensors & Hardware Interlocks

- **Paper Low Sensor**: Optical sensor alerting when paper roll radius drops below 15% remaining capacity.  
- **Paper Out Sensor**: Reflective optical sensor inhibiting motor drive and thermal strobe when paper is exhausted.  
- **Platen Open Microswitch**: Safety interlock disabling print mechanism when paper compartment latch is open.  
- **Paper Feed Stepper Motor**: Advance rate 25.0 mm/sec nominal (up to 50.0 mm/sec for fast form feed).

## 4\. Digital ARINC 429 Bus Interface

- **Label 172**: Character Data Transfer Word (packed ASCII character streaming).  
- **Label 173**: Display / Print Format Control Word (Line Feed, Form Feed, Invert, Bold).  
- **Label 270**: Printer Discrete Status Word (Ready, Paper Low, Paper Out, Platen Open, Over-Temp, Buffer Full).  
- **Label 350**: Printer BITE Fault Word (Stepper motor fault, head dot burnout, NVRAM fault, voltage low).  
- **Label 357**: Print Job Status & Acknowledgement Word (Lines printed count, job completion status).  
- **Parity**: Strict Bit 32 odd parity enforced across all words.