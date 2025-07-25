const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');

async function run() {
  try {
    const imagesInput = core.getInput('images');
    const imagesFileInput = core.getInput('images-file');

    if (!imagesInput && !imagesFileInput) {
      throw new Error('Either "images" or "images-file" input must be provided');
    }

    if (imagesInput && imagesFileInput) {
      throw new Error('Only one of "images" or "images-file" inputs should be provided, not both');
    }

    let images;
    try {
      if (imagesInput) {
        images = JSON.parse(imagesInput);
        if (!Array.isArray(images)) {
          images = [images];
        }
      } else {
        core.info(`Reading images from file: ${imagesFileInput}`);
        const fileContent = fs.readFileSync(imagesFileInput, 'utf8');
        images = JSON.parse(fileContent);
        if (!Array.isArray(images)) {
          images = [images];
        }
      }
    } catch (parseError) {
      const source = imagesInput ? 'images input' : `images file: ${imagesFileInput}`;
      throw new Error(`Invalid images format in ${source}. Expected JSON array or object: ${parseError.message}`);
    }

    for (const image of images) {
      if (!image.source || !image.destination || !image.architecture) {
        throw new Error('Each image mapping must have "source", "destination", and "architecture" properties');
      }
    }

    core.info(`Starting mirror process for ${images.length} image(s)`);

    const results = [];
    let successCount = 0;

    for (let i = 0; i < images.length; i++) {
      const { source: sourceImage, destination: destinationImage, architecture } = images[i];

      try {
        const archInfo = architecture ? ` (${architecture})` : '';
        core.info(`\n--- Processing image ${i + 1}/${images.length}: ${sourceImage} -> ${destinationImage}${archInfo} ---`);

        const pullArgs = ['pull'];
        if (architecture) {
          pullArgs.push('--platform', architecture);
        }
        pullArgs.push(sourceImage);

        core.info(`Pulling source image: ${sourceImage}${archInfo}`);
        await exec.exec('docker', pullArgs);

        core.info(`Tagging image as: ${destinationImage}`);
        await exec.exec('docker', ['tag', sourceImage, destinationImage]);

        core.info(`Pushing to destination registry: ${destinationImage}`);
        await exec.exec('docker', ['push', destinationImage]);

        const imageInfo = await getImageInfo(destinationImage);

        results.push({
          source: sourceImage,
          destination: destinationImage,
          digest: imageInfo.digest,
          size: imageInfo.size,
          status: 'success'
        });

        successCount++;
        core.info(`✅ Successfully mirrored: ${sourceImage} -> ${destinationImage}`);

      } catch (imageError) {
        core.error(`❌ Failed to mirror ${sourceImage} -> ${destinationImage}: ${imageError.message}`);
        results.push({
          source: sourceImage,
          destination: destinationImage,
          digest: '',
          size: '',
          status: 'failed',
          error: imageError.message
        });
      }
    }

    core.setOutput('results', JSON.stringify(results));
    core.setOutput('success-count', successCount.toString());
    core.setOutput('total-count', images.length.toString());

    if (successCount === images.length) {
      core.info(`🎉 All ${images.length} image(s) mirrored successfully!`);
    } else {
      core.error(`❌ ${successCount}/${images.length} image(s) mirrored successfully`);
      core.setFailed(`Failed to sync ${images.length - successCount} out of ${images.length} image(s)`);
    }

  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}


async function getImageInfo(image) {
  let digest = '';
  let size = '';

  try {
    const digestOutput = await exec.getExecOutput('docker', [
      'inspect', 
      '--format={{index .RepoDigests 0}}', 
      image
    ]);
    digest = digestOutput.stdout.trim();

    const sizeOutput = await exec.getExecOutput('docker', [
      'inspect', 
      '--format={{.Size}}', 
      image
    ]);
    size = sizeOutput.stdout.trim();

  } catch (error) {
    core.warning(`Could not retrieve image info: ${error.message}`);
  }

  return { digest, size };
}


run();
