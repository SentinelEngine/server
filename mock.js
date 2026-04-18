import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

const app = Fastify();
await app.register(fastifyJwt, { secret: 'secret' });
app.get('/test', async (req, reply) => {
  try {
    const token = app.jwt.sign({ sub: '123' }, { expiresIn: '7d' });
    return reply.send({ token });
  } catch (err) {
    return reply.send({ error: err.message });
  }
});
await app.listen({ port: 3005 });
console.log('Listening');
