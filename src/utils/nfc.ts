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

export class NFCManager {
  private static instance: NFCManager;
  private reader: any = null;
  private isScanning: boolean = false;
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;
  private scanStartTime: number = 0;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
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
      if (!('NDEFReader' in window)) {
        console.log('NDEFReader not available - use Chrome on Android');
        return {
          tagId: '',
          success: false,
          error: 'NFC not supported. Use Chrome on Android with NFC enabled.'
        };
      }

      console.log('Creating NDEFReader instance...');
      
      // Create new NDEFReader instance
      this.reader = new (window as any).NDEFReader();
      console.log('NDEFReader created successfully:', this.reader);
      
      return new Promise(async (resolve) => {
        let resolved = false;
        
        const cleanup = () => {
          if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
          }
          if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
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
        
        console.log('Setting up Promise for NFC scan...');

        // Set up event handlers BEFORE calling scan()
        this.reader.onreading = (event: any) => {
          console.log('✅ NFC tag detected!', event);
          const tagId = this.extractTagId(event);
          console.log('Extracted tag ID:', tagId);
          
          // Add success vibration when tag is detected
          this.vibrate([200, 100, 200]);
          
          resolveOnce({
            tagId,
            success: true
          });
        };

        this.reader.onreadingerror = (error: any) => {
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

        try {
          console.log('Attempting to start NFC scan...');
          await this.reader.scan();
          console.log('✅ NFC scan started successfully! Place your tag near the device...');
          
          // Start scan state tracking
          this.scanStartTime = Date.now();
          this.startProgressTracking();
          this.updateScanState();
          
        } catch (scanError: any) {
          console.error('❌ Failed to start NFC scan:', scanError);
          console.error('Scan error name:', scanError?.name);
          console.error('Scan error message:', scanError?.message);
          
          let errorMessage = 'Failed to start NFC scanning. ';
          if (scanError?.name === 'NotAllowedError') {
            errorMessage += 'NFC permission denied. Please enable NFC and try again.';
          } else if (scanError?.name === 'NotSupportedError') {
            errorMessage += 'NFC not supported on this device.';
          } else if (scanError?.name === 'InvalidStateError' || scanError?.name === 'InvalidState') {
            errorMessage += 'Scanner already active. Please wait and try again.';
          } else {
            errorMessage += `Error: ${scanError?.message || 'Unknown error'}`;
          }
          
          resolveOnce({
            tagId: '',
            success: false,
            error: errorMessage
          });
        }
      });
      
    } catch (error: any) {
      console.error('❌ NFC scan error in try/catch:', error);
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      
      // Handle different error types
      let errorMessage = 'NFC scanning failed. ';
      
      if (error?.name === 'NotAllowedError') {
        errorMessage += 'NFC permission denied or not available.';
      } else if (error?.name === 'NotSupportedError') {
        errorMessage += 'NFC not supported on this device. Use Chrome on Android with NFC enabled.';
      } else if (error?.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please try again or check if NFC is enabled.';
      }
      
      return {
        tagId: '',
        success: false,
        error: errorMessage
      };
    } finally {
      this.isScanning = false;
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
    this.scanStartTime = 0;
    this.updateScanState();
    console.log('✅ NFC manager force reset complete');
  }

  /**
   * Extract tag ID from NFC reading event
   */
  private extractTagId(event: any): string {
    try {
      // Try to get serial number first
      if (event.serialNumber) {
        return this.formatTagId(event.serialNumber);
      }
      
      // Fallback to generating ID from records
      if (event.message && event.message.records) {
        const record = event.message.records[0];
        if (record && record.data) {
          const dataView = new DataView(record.data);
          let id = '';
          for (let i = 0; i < Math.min(4, dataView.byteLength); i++) {
            id += dataView.getUint8(i).toString(16).padStart(2, '0');
          }
          return this.formatTagId(id);
        }
      }
      
      // Final fallback - return empty string for production
      return '';
      
    } catch (error) {
      console.warn('Error extracting tag ID:', error);
      return '';
    }
  }

  /**
   * Format tag ID for consistent display
   */
  private formatTagId(rawId: string): string {
    // Remove any non-alphanumeric characters and convert to uppercase
    const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // Ensure it starts with NFC prefix
    if (cleanId.startsWith('NFC')) {
      return cleanId.substring(0, 9); // NFC + 6 characters
    } else {
      return `NFC${cleanId.substring(0, 6)}`;
    }
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