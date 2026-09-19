import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class ImageService {
  async downloadImage(imageUrl: string, filename: string): Promise<string> {
    try {
      // Define the path where the image will be saved
      const imagePath = path.join( process.env.UPLOAD_LOCATION || '/var/www/react-app/cdn',  filename);

      // Fetch the image as a stream
      const response = await axios({
        url: imageUrl,
        responseType: 'stream',
      });

      // Create a writable stream to save the file
      const writer = fs.createWriteStream(imagePath);
      response.data.pipe(writer);

      // Return a promise that resolves when writing is complete
      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(imagePath));
        writer.on('error', reject);
      });
    } catch (error) {
      const message =
    error instanceof Error
      ? error.message
      : String(error);
      throw new Error(`Error downloading image: ${message}`);
    }
  }
}
