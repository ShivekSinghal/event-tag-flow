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
    return this.scanWithWebNFC();
  }


  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    try {
      // Proper feature detection as per Chrome docs
      if (!('NDEFReader' in window)) {
        console.log('NDEFReader not available - use Chrome on Android');
        return {
          tagId: '',
          success: false,
          error: 'NFC not supported. Use Chrome on Android with NFC enabled.'
        };
      }

      console.log('Starting NFC scan...');
      
      // Create new NDEFReader instance using proper Chrome pattern
      this.reader = new (window as any).NDEFReader();
      
      // Start scanning - this returns a promise that resolves when scan starts
      await this.reader.scan();
      console.log('Scan started successfully - waiting for NFC tag...');
      
      return new Promise((resolve) => {
        // Use proper Chrome pattern for event listeners
        this.reader.onreading = (event: any) => {
          console.log('NFC tag detected!', event);
          const tagId = this.extractTagId(event);
          resolve({
            tagId,
            success: true
          });
        };

        this.reader.onreadingerror = (error: any) => {
          console.warn('NFC reading error:', error);
          resolve({
            tagId: '',
            success: false,
            error: 'Cannot read data from the NFC tag. Try another one?'
          });
        };

        // Timeout after 30 seconds
        setTimeout(() => {
          resolve({
            tagId: '',
            success: false,
            error: 'NFC scan timeout. Please try again.'
          });
        }, 30000);
      });
      
    } catch (error: any) {
      console.warn('NFC scan error:', error);
      
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