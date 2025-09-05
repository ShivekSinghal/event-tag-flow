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
   * Check if NFC is supported on this device
   */
  isNFCSupported(): boolean {
    // Check WebNFC API support (Chrome on Android)
    return 'NDEFReader' in window;
  }

  /**
   * Check if NFC permission is granted
   */
  async checkNFCPermission(): Promise<boolean> {
    if (!this.isNFCSupported()) return false;
    
    try {
      const permission = await navigator.permissions.query({ name: 'nfc' as any });
      return permission.state === 'granted';
    } catch (error) {
      console.warn('NFC permission check failed:', error);
      return false;
    }
  }

  /**
   * Start scanning for NFC tags
   */
  async startScanning(): Promise<NFCReadResult> {
    if (!this.isNFCSupported()) {
      return {
        tagId: '',
        success: false,
        error: 'NFC not supported on this device. Please use Chrome on Android with NFC enabled.'
      };
    }

    // Use WebNFC API
    return this.scanWithWebNFC();
  }


  /**
   * Scan using WebNFC API (Chrome on Android)
   */
  private async scanWithWebNFC(): Promise<NFCReadResult> {
    try {
      // Create new NDEFReader instance
      this.reader = new (window as any).NDEFReader();
      
      // Start scanning
      await this.reader.scan();
      
      return new Promise((resolve) => {
        // Set up event listeners
        this.reader.addEventListener('reading', (event: any) => {
          const tagId = this.extractTagId(event);
          resolve({
            tagId,
            success: true
          });
        });

        this.reader.addEventListener('readingerror', (error: any) => {
          resolve({
            tagId: '',
            success: false,
            error: `NFC reading failed: ${error.message}`
          });
        });

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
      return {
        tagId: '',
        success: false,
        error: `NFC scan failed: ${error.message}`
      };
    }
  }

  /**
   * Stop NFC scanning
   */
  stopScanning(): void {
    // Stop WebNFC scanning
    if (this.reader) {
      try {
        this.reader.removeAllListeners?.();
        this.reader = null;
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