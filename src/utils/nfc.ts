/**
 * NFC Utility functions using WebNFC API
 * Works in Chrome on Android devices with NFC support
 */

export interface NFCReadResult {
  tagId: string;
  success: boolean;
  error?: string;
}

export interface NFCScanState {
  isScanning: boolean;
  duration: number;
  lastError?: string;
}

interface NFCReadingEvent extends Event {
  serialNumber?: string;
}

interface NDEFReaderLike {
  onreading: ((event: NFCReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
  scan: (options: { signal: AbortSignal }) => Promise<void>;
}

interface WindowWithNDEFReader extends Window {
  NDEFReader?: new () => NDEFReaderLike;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Test-stack fallback: on a build with VITE_ALLOW_TYPED_TAG=true (or a dev build), devices without Web NFC
// (laptops, iPhones) can type a band id instead of tapping. Never set that flag on production.
export function allowTypedTag(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ALLOW_TYPED_TAG === "true";
}

export class NFCManager {
  private static instance: NFCManager;
  private reader: NDEFReaderLike | null = null;
  private isScanning: boolean = false;
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;
  private scanStartTime: number = 0;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private cancelActiveScan: (() => void) | null = null;
  private onScanStateChange?: (state: NFCScanState) => void;

  static getInstance(): NFCManager {
    if (!NFCManager.instance) {
      NFCManager.instance = new NFCManager();
    }
    return NFCManager.instance;
  }

  constructor() {
    // WebNFC only implementation
  }

  /**
   * Set callback for scan state changes
   */
  setScanStateCallback(callback: (state: NFCScanState) => void): void {
    this.onScanStateChange = callback;
  }

  /**
   * Get current scan state
   */
  getScanState(): NFCScanState {
    return {
      isScanning: this.isScanning,
      duration: this.isScanning ? Date.now() - this.scanStartTime : 0,
    };
  }

  /**
   * Start scanning for NFC tags
   */
  async startScanning(): Promise<NFCReadResult> {
    console.log('🔍 startScanning() called - this should show up in console');
    console.log('Current URL:', window.location.href);
    console.log('User agent:', navigator.userAgent);
    console.log('Current scanning state:', this.isScanning);
    
    // Always stop any existing scan before starting a new one
    this.stopScanning();
    
    // Add vibration feedback when starting scan (every time)
    this.vibrate([100]);
    
    return this.scanWithWebNFC();
  }


  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    console.log('=== NFC SCAN DEBUG START ===');
    
    // Prevent multiple concurrent scans
    if (this.isScanning) {
      console.warn('⚠️ Scan already in progress, ignoring new scan request');
      return {
        tagId: '',
        success: false,
        error: 'Scan already in progress. Please wait.'
      };
    }

    this.isScanning = true;
    
    try {
      // Check browser and environment
      console.log('User Agent:', navigator.userAgent);
      console.log('Platform:', navigator.platform);
      console.log('NFC available:', 'NDEFReader' in window);
      
      // Proper feature detection as per Chrome docs
      const NDEFReader = (window as WindowWithNDEFReader).NDEFReader;
      if (!NDEFReader) this.isScanning = false;
      if (!NDEFReader && allowTypedTag()) {
        const typed = window.prompt("No NFC on this device. Type the band's tag ID (test mode):", "");
        const value = (typed || "").trim();
        if (value.length >= 4) {
          return { tagId: this.formatTagId(value) || value.toUpperCase(), success: true };
        }
        return { tagId: '', success: false, error: 'No tag ID entered.' };
      }
      if (!NDEFReader) {
        console.log('NDEFReader not available - use Chrome on Android');
        return {
          tagId: '',
          success: false,
          error: 'NFC not supported. Use Chrome on Android with NFC enabled.'
        };
      }

      console.log('Creating NDEFReader instance...');
      
      // Create new NDEFReader instance
      const reader = new NDEFReader();
      this.reader = reader;
      console.log('NDEFReader created successfully:', reader);
      
      return await new Promise<NFCReadResult>((resolve) => {
        let resolved = false;
        const controller = new AbortController();
        let cancelCurrentScan: (() => void) | null = null;
        
        const cleanup = () => {
          reader.onreading = null;
          reader.onreadingerror = null;
          controller.abort();
          // An old permission request must never tear down a newer attempt.
          if (this.reader !== reader) return;
          this.reader = null;
          if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
          }
          if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
          }
          if (this.cancelActiveScan === cancelCurrentScan) {
            this.cancelActiveScan = null;
          }
          this.isScanning = false;
          this.updateScanState();
        };

        const resolveOnce = (result: NFCReadResult) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(result);
        };

        cancelCurrentScan = () => {
          resolveOnce({
            tagId: '',
            success: false,
            error: 'NFC scan cancelled.',
          });
        };
        this.cancelActiveScan = cancelCurrentScan;
        
        console.log('Setting up Promise for NFC scan...');

        // Set up event handlers BEFORE calling scan()
        reader.onreading = (event) => {
          if (resolved || controller.signal.aborted) return;
          console.log('✅ NFC tag detected!', event);
          const tagId = this.extractTagId(event);
          console.log('Extracted tag ID:', tagId);
          if (!tagId) {
            resolveOnce({
              tagId: '',
              success: false,
              error: 'This band did not provide a valid NFC UID. Try another scan or use the staff wallet lookup.',
            });
            return;
          }
          
          // Add success vibration when tag is detected
          this.vibrate([200, 100, 200]);
          
          resolveOnce({
            tagId,
            success: true
          });
        };

        reader.onreadingerror = (error) => {
          if (resolved || controller.signal.aborted) return;
          console.warn('❌ NFC reading error (continuing scan):', error);
          // Don't stop scanning on read errors - just update state with error info
          this.updateScanState('NFC read error - keep trying...');
        };

        // Setup timeout
        this.scanTimeout = setTimeout(() => {
          console.log('⏰ NFC scan timeout after 7 seconds');
          resolveOnce({
            tagId: '',
            success: false,
            error: 'NFC scan timeout. Please try again.'
          });
        }, 7000);

        const beginScan = async () => {
          try {
            console.log('Attempting to start NFC scan...');
            await reader.scan({ signal: controller.signal });
            if (resolved || controller.signal.aborted || this.reader !== reader) return;
            console.log('✅ NFC scan started successfully! Place your tag near the device...');

            // Start scan state tracking
            this.scanStartTime = Date.now();
            this.startProgressTracking();
            this.updateScanState();

          } catch (scanError: unknown) {
            if (resolved || controller.signal.aborted) return;
            const normalizedError = normalizeError(scanError);
            console.error('❌ Failed to start NFC scan:', normalizedError);
            console.error('Scan error name:', normalizedError.name);
            console.error('Scan error message:', normalizedError.message);

            let errorMessage = 'Failed to start NFC scanning. ';
            if (normalizedError.name === 'NotAllowedError') {
              errorMessage += 'NFC permission denied. Please enable NFC and try again.';
            } else if (normalizedError.name === 'NotSupportedError') {
              errorMessage += 'NFC not supported on this device.';
            } else if (normalizedError.name === 'InvalidStateError' || normalizedError.name === 'InvalidState') {
              errorMessage += 'Scanner already active. Please wait and try again.';
            } else {
              errorMessage += `Error: ${normalizedError.message || 'Unknown error'}`;
            }

            resolveOnce({
              tagId: '',
              success: false,
              error: errorMessage
            });
          }
        };

        void beginScan();
      });
      
    } catch (error: unknown) {
      this.isScanning = false;
      const normalizedError = normalizeError(error);
      console.error('❌ NFC scan error in try/catch:', normalizedError);
      console.error('Error name:', normalizedError.name);
      console.error('Error message:', normalizedError.message);
      console.error('Error stack:', normalizedError.stack);
      
      // Handle different error types
      let errorMessage = 'NFC scanning failed. ';
      
      if (normalizedError.name === 'NotAllowedError') {
        errorMessage += 'NFC permission denied or not available.';
      } else if (normalizedError.name === 'NotSupportedError') {
        errorMessage += 'NFC not supported on this device. Use Chrome on Android with NFC enabled.';
      } else if (normalizedError.message) {
        errorMessage += normalizedError.message;
      } else {
        errorMessage += 'Please try again or check if NFC is enabled.';
      }
      
      return {
        tagId: '',
        success: false,
        error: errorMessage
      };
    } finally {
      console.log('=== NFC SCAN DEBUG END ===');
    }
  }

  /**
   * Start progress tracking during scan
   */
  private startProgressTracking(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    this.progressInterval = setInterval(() => {
      this.updateScanState();
    }, 1000); // Update every second
  }

  /**
   * Update scan state and notify callback
   */
  private updateScanState(lastError?: string): void {
    if (this.onScanStateChange) {
      this.onScanStateChange({
        isScanning: this.isScanning,
        duration: this.isScanning ? Date.now() - this.scanStartTime : 0,
        lastError
      });
    }
  }

  /**
   * Stop NFC scanning
   */
  stopScanning(): void {
    console.log('🛑 Stopping NFC scan...');

    // Settle the promise owned by the active scan before removing its handlers.
    // POS uses this when a staff member switches to the manual wallet lookup.
    const cancelActiveScan = this.cancelActiveScan;
    this.cancelActiveScan = null;
    cancelActiveScan?.();
    
    // Clear timeout and progress tracking
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
    
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    
    // Stop WebNFC scanning using proper Chrome pattern
    if (this.reader) {
      try {
        // Clear event handlers first
        this.reader.onreading = null;
        this.reader.onreadingerror = null;
        this.reader = null;
        console.log('✅ NFC reader cleaned up');
      } catch (error) {
        console.warn('⚠️ Error stopping WebNFC scan:', error);
      }
    }
    
    // Reset scanning state
    this.isScanning = false;
    this.updateScanState();
    console.log('✅ NFC scanning stopped');
  }

  /**
   * Force reset the NFC manager (for recovery from stuck states)
   */
  forceReset(): void {
    console.log('🔄 Force resetting NFC manager...');
    this.stopScanning();
    // Additional cleanup if needed
    this.reader = null;
    this.isScanning = false;
    this.scanTimeout = null;
    this.progressInterval = null;
    this.cancelActiveScan = null;
    this.scanStartTime = 0;
    this.updateScanState();
    console.log('✅ NFC manager force reset complete');
  }

  /**
   * Extract tag ID from NFC reading event
   */
  private extractTagId(event: NFCReadingEvent): string {
    // Tag-written records are never an identity source, even when the UID is missing.
    return typeof event.serialNumber === 'string' ? this.formatTagId(event.serialNumber) : '';
  }

  /**
   * Canonical wallet identity: retain every UID byte. Shorten only in the UI.
   */
  private formatTagId(rawId: string): string {
    const uid = rawId.trim().replace(/^NFC/i, '');
    if (!/^[0-9a-f]{2}(?:[\s:-]?[0-9a-f]{2})*$/i.test(uid)) return '';
    return `NFC${uid.replace(/[\s:-]/g, '').toUpperCase()}`;
  }

  /**
   * Trigger vibration if supported
   */
  private vibrate(pattern: number | number[]): void {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (error) {
      // Silently fail if vibration not supported
      console.log('Vibration not supported');
    }
  }

}

// Export singleton instance
export const nfcManager = NFCManager.getInstance();
