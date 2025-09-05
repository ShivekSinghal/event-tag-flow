/**
 * NFC Utility functions using WebNFC API
 * Works in Chrome on Android devices with NFC support
 */

export interface NFCReadResult {
  tagId: string;
  success: boolean;
  error?: string;
}

export class NFCManager {
  private static instance: NFCManager;
  private reader: any = null;

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
   * Start scanning for NFC tags
   */
  async startScanning(): Promise<NFCReadResult> {
    console.log('🔍 startScanning() called - this should show up in console');
    console.log('Current URL:', window.location.href);
    console.log('User agent:', navigator.userAgent);
    
    return this.scanWithWebNFC();
  }


  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    console.log('=== NFC SCAN DEBUG START ===');
    
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
        let scanStarted = false;
        
        console.log('Setting up Promise for NFC scan...');

        // Only set up error handler for actual reading errors, not scan start errors
        this.reader.onreading = (event: any) => {
          if (resolved) return;
          resolved = true;
          console.log('✅ NFC tag detected!', event);
          const tagId = this.extractTagId(event);
          console.log('Extracted tag ID:', tagId);
          resolve({
            tagId,
            success: true
          });
        };

        // Timeout after 30 seconds - only if scan actually started
        const timeoutId = setTimeout(() => {
          if (resolved || !scanStarted) return;
          resolved = true;
          console.log('⏰ NFC scan timeout after 30 seconds');
          resolve({
            tagId: '',
            success: false,
            error: 'NFC scan timeout. Please try again.'
          });
        }, 30000);

        try {
          console.log('Attempting to start NFC scan...');
          await this.reader.scan();
          scanStarted = true;
          console.log('✅ NFC scan started successfully! Place your tag near the device...');
          
          // Only set up error handler after scan starts successfully
          this.reader.onreadingerror = (error: any) => {
            if (resolved) return;
            resolved = true;
            console.warn('❌ NFC reading error after scan started:', error);
            clearTimeout(timeoutId);
            resolve({
              tagId: '',
              success: false,
              error: 'Cannot read data from the NFC tag. Try another one?'
            });
          };
          
        } catch (scanError: any) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          console.error('❌ Failed to start NFC scan:', scanError);
          console.error('Scan error name:', scanError?.name);
          console.error('Scan error message:', scanError?.message);
          
          let errorMessage = 'Failed to start NFC scanning. ';
          if (scanError?.name === 'NotAllowedError') {
            errorMessage += 'NFC permission denied. Please enable NFC and try again.';
          } else if (scanError?.name === 'NotSupportedError') {
            errorMessage += 'NFC not supported on this device.';
          } else if (scanError?.name === 'InvalidState') {
            errorMessage += 'NFC is not available. Please check your device settings.';
          } else {
            errorMessage += `Error: ${scanError?.message || 'Unknown error'}`;
          }
          
          resolve({
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
      console.log('=== NFC SCAN DEBUG END ===');
    }
  }

  /**
   * Stop NFC scanning
   */
  stopScanning(): void {
    // Stop WebNFC scanning using proper Chrome pattern
    if (this.reader) {
      try {
        // Clear event handlers
        this.reader.onreading = null;
        this.reader.onreadingerror = null;
        this.reader = null;
        console.log('NFC scanning stopped');
      } catch (error) {
        console.warn('Error stopping WebNFC scan:', error);
      }
    }
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

}

// Export singleton instance
export const nfcManager = NFCManager.getInstance();