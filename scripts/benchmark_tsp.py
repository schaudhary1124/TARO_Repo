import time
import random
from app.api.router import local_greedy_tsp, two_opt


def random_coords(n):
    return [(random.uniform(38.0, 41.0), random.uniform(-84.5, -80.0)) for _ in range(n)]


def bench(n):
    coords = random_coords(n)
    start = time.time()
    order = local_greedy_tsp(coords)
    gtime = time.time() - start
    start = time.time()
    o2 = two_opt(order, coords)
    ttime = time.time() - start
    print(f'n={n:4d} greedy={gtime:.4f}s 2opt={ttime:.4f}s')


if __name__ == '__main__':
    for n in [10, 50, 100, 200, 400]:
        bench(n)
