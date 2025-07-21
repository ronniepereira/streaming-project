import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import { PrismaService } from '@src/prisma.service';
import { randomUUID } from 'crypto';
import fs, { statSync } from 'fs';
import path from 'path';
import request from 'supertest';

describe('VideoController (e2e)', () => {
  let module: TestingModule;
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    prismaService = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    jest
      .useFakeTimers({ advanceTimers: true })
      .setSystemTime(new Date('2023-01-01'));
  });

  afterEach(async () => {
    await prismaService.video.deleteMany();
  });

  afterAll(async () => {
    module.close();
    fs.rmSync('./uploads', { recursive: true, force: true });
    await app.close();
  });

  describe('/video (POST)', () => {
    it('should be able to upload a video', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 1430145,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', './test/fixtures/sample.mp4')
        .attach('thumbnail', './test/fixtures/sample.jpg')
        .field('title', video.title)
        .field('description', video.description)
        .expect(HttpStatus.CREATED)
        .expect((response) => {
          expect(response.body).toMatchObject({
            title: video.title,
            description: video.description,
            url: expect.stringContaining('mp4'),
            thumbnailUrl: expect.stringContaining('jpg'),
            sizeInKb: video.sizeInKb,
            duration: video.duration,
          });
        });

      const videoInDb = await prismaService.video.findFirst({
        where: {
          title: video.title,
        },
      });
      expect(videoInDb).toBeDefined();
    });

    it('does not allow uploading a video with invalid file type', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 1430145,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', './test/fixtures/sample.mp3')
        .attach('thumbnail', './test/fixtures/sample.jpg')
        .field('title', video.title)
        .field('description', video.description)
        .expect(HttpStatus.BAD_REQUEST)
        .expect({
          message:
            'Invalid file type. Only video/mp4 and image/jpeg are supported',
          error: 'Bad Request',
          statusCode: 400,
        });
    });

    it('does not allow uploading a video without thumbnail', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: null,
        sizeInKb: 1430145,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', './test/fixtures/sample.mp4')
        .field('title', video.title)
        .field('description', video.description)
        .expect(HttpStatus.BAD_REQUEST)
        .expect({
          message: 'Both video and thumbnail files are required',
          error: 'Bad Request',
          statusCode: 400,
        });
    });
  });

  describe('/stream/:videoId (GET)', () => {
    it('should be able to stream a video', async () => {
      const videoPath = path.join('.', 'test/fixtures/sample.mp4');
      const videoSize = statSync(videoPath).size;

      const video = await prismaService.video.create({
        data: {
          id: randomUUID(),
          title: 'Test Video',
          description: 'This is a test video',
          url: videoPath,
          thumbnailUrl: path.join('.', 'test/fixtures/sample.jpg'),
          sizeInKb: videoSize,
          duration: 100,
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/stream/${video.id}`)
        .set('Range', `bytes=0-${videoSize - 1}`);

      expect(response.status).toBe(HttpStatus.PARTIAL_CONTENT);
      expect(response.headers['content-type']).toBe('video/mp4');
      expect(response.headers['accept-ranges']).toBe('bytes');
      expect(response.headers['content-length']).toBe(String(videoSize));
      expect(response.headers['content-range']).toBe(
        `bytes 0-${videoSize - 1}/${videoSize}`,
      );
    });

    it('should be able to not stream a video if it does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/stream/${randomUUID()}`)
        .expect(HttpStatus.NOT_FOUND)
        .expect({
          statusCode: 404,
          message: 'Video not found',
          error: 'Not Found',
        });
    });
  });
});
