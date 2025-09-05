/**
 * NFC Utility functions for cross-platform NFC scanning
 * Uses @exxili/capacitor-nfc for iOS/Android and WebNFC API as fallback
 */

import { Capacitor } from '@capacitor/core';

export interface NFCReadResult {
  tagId: string;
  success: boolean;
  error?: string;
}

export class NFCManager {
  private static instance: NFCManager;
  private reader: any = null;
  private nfcPlugin: any = null;

  static getInstance(): NFCManager {
    if (!NFCManager.instance) {
      NFCManager.instance = new NFCManager();
    }
    return NFCManager.instance;
  }

  constructor() {
    // Import NFC plugin dynamically for mobile platforms
    if (Capacitor.isNativePlatform()) {
      import('@exxili/capacitor-nfc').then((module) => {
        this.nfcPlugin = module.NFC;
      }).catch(() => {
        console.warn('NFC plugin not available');
      });
    }
  }

  /**
   * Check if NFC is supported on this device
   */
  isNFCSupported(): boolean {
    // For native platforms (iOS/Android), assume NFC is available
    if (Capacitor.isNativePlatform()) {
      return true; // Will be checked properly when scanning
    }
    // For web, check WebNFC API (Chrome on Android)
    return 'NDEFReader' in window;
  }

  /**
   * Check if device is iOS in web browser
   */
  isIOSWeb(): boolean {
    return !Capacitor.isNativePlatform() && 
           /iPad|iPhone|iPod/.test(navigator.userAgent);
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
      if (Capacitor.isNativePlatform()) {
        return {
          tagId: '',
          success: false,
          error: 'NFC not available. Please enable NFC in device settings.'
        };
      } else {
        return {
          tagId: '',
          success: false,
          error: 'NFC not supported in this browser. Please use Chrome on Android or install the mobile app for iPhone/Android NFC support.'
        };
      }
    }

    // Use native NFC plugin for iOS/Android
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      return this.scanWithNativePlugin();
    }

    // Use WebNFC API for web browsers
    return this.scanWithWebNFC();
  }

  /**
   * Scan using @exxili/capacitor-nfc plugin (iOS/Android)
   */
  private async scanWithNativePlugin(): Promise<NFCReadResult> {
    try {
      // Check if NFC is available
      const isAvailable = await this.nfcPlugin.isAvailable();
      if (!isAvailable.available) {
        return {
          tagId: '',
          success: false,
          error: 'NFC is not available on this device. Please enable NFC in settings.'
        };
      }

      // Start scanning for NDEF messages
      const result = await this.nfcPlugin.readTag();

      if (result && result.message && result.message.records && result.message.records.length > 0) {
        // Extract tag identifier from the first record or use a generated ID
        const record = result.message.records[0];
        let tagId = '';
        
        if (record.id) {
          tagId = this.formatTagId(record.id);
        } else if (record.payload) {
          // Generate ID from payload
          const decoder = new TextDecoder();
          const text = decoder.decode(new Uint8Array(record.payload));
          tagId = this.formatTagId(text.substring(0, 6));
        } else {
          // Generate a timestamp-based ID
          tagId = this.formatTagId(Date.now().toString().slice(-6));
        }

        return {
          tagId,
          success: true
        };
      } else {
        return {
          tagId: '',
          success: false,
          error: 'Failed to read NFC tag. Please try again.'
        };
      }

    } catch (error: any) {
      return {
        tagId: '',
        success: false,
        error: `NFC scan failed: ${error.message || 'Unknown error'}`
      };
    }
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
    // Stop native NFC scanning - this plugin doesn't require explicit stop
    if (Capacitor.isNativePlatform() && this.nfcPlugin) {
      // The @exxili/capacitor-nfc plugin doesn't require explicit stop
      console.log('NFC scan completed');
    }

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
   * Show manual input dialog for iOS users (fallback)
   */
  private async showManualInput(): Promise<NFCReadResult> {
    return new Promise((resolve) => {
      const tagId = prompt(
        "iOS Safari doesn't support NFC scanning.\n\n" +
        "Please enter the NFC tag ID manually\n" +
        "(or use the native iOS app for proper NFC scanning):"
      );

      if (tagId && tagId.trim()) {
        resolve({
          tagId: this.formatTagId(tagId.trim()),
          success: true
        });
      } else {
        resolve({
          tagId: '',
          success: false,
          error: 'Manual input cancelled. For full NFC support, please use the native iOS app.'
        });
      }
    });
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