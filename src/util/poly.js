/* jshint node:true */
'use strict';

var _ = require('lodash');


module.exports = Poly;


/**
 *
 * Poly
 *
 * @param degrees - array of polynom degree indexes
 *
 */
function Poly(degrees) {
    var self = this;

    var words = [0];
    var degree = 0;
    _.each(degrees, function(d) {
        var word = (d / 32) | 0;
        while (words.length < word) words.push(0);
        words[word] |= 1 << (d % 32);
        if (d > degree) degree = d;
    });

    this.nwords = words.length;
    this.degree = degree;
    this.high_bit = 1 << ((degree % 32) - 1);

    if (this.nwords <= 1) {
        this.val = words[0];
        this.deg = deg_32bit;
        this.mod = this.mod_32bit;
        this.xor = xor_32bit;
        this.orr = orr_32bit;
        this.mult = this.mult_mod_32bit;
        this.shift_bit_mod = this.shift_bit_mod_32bit;
        this.shift_left_mod = this.shift_left_mod_32bit;
        this.shift_byte_mod = this.shift_byte_mod_32bit;
        this.shift_left = shift_left_32bit;
        this.shift_right = shift_right_32bit;

        this.max = ~0 << (32 - degree) >>> (32 - degree);
        this.zero = function() {
            return 0;
        };

        // TODO test performance with log tables
        // if (this.init_log_table()) {
        //     this.mult = this.mult_with_log;
        // }

    } else {
        this.val = words;
        this.deg = this.deg_nbit;
        this.mod = this.mod_nbit;
        this.xor = this.xor_nbit;
        this.orr = this.orr_nbit;
        this.mult = this.mult_nbit;
        this.shift_bit_mod = this.shift_bit_mod_nbit;
        this.shift_left_mod = this.shift_left_mod_nbit;
        this.shift_byte_mod = this.shift_byte_mod_nbit;
        this.shift_left = this.shift_left_nbit;
        this.shift_right = this.shift_right_nbit;

        this.max = Math.pow(2, degree) - 1;
        var lwm = 32 - (degree % 32);
        this.last_word_mask = ~0 << lwm >>> lwm;
        this.last_word = this.nwords - 1;
        var zero_nbit = _.times(this.nwords, function() {
            return 0;
        });
        this.zero = function() {
            return _.clone(zero_nbit);
        };

        // optimized versions for 2 words
        if (this.nwords === 2) {
            this.deg = this.deg_64bit;
            this.mod = this.mod_64bit;
            this.xor = this.xor_64bit;
            this.orr = this.orr_64bit;
            this.shift_bit_mod = this.shift_bit_mod_64bit;
            this.shift_left_mod = this.shift_left_mod_64bit;
            this.shift_byte_mod = this.shift_byte_mod_64bit;
            this.zero = function() {
                return [0, 0];
            };
        }
    }


    this.shift_byte_mod_offset = degree - 8;

    // this is a lookup table to speed up shifting by batching bytes
    // each entry is a value that will be xor'ed after shifting left 8 bits.
    // the value is composed of two parts or'ed together - mod_val and cancel_val.
    // mod_val is b(x) * x^d (mod p) where d is deg(p)
    //   and represents the commulative effect of shifting out these 8 bits of the byte
    // cancel_val is b(x) * x^d
    //   and just added in order to cancel those shifted bits in a single xor.
    this.shift_byte_mod_table = _.times(256, function(byte) {
        var mod_val = self.mod(byte);
        for (var i = 0; i < degree; ++i) {
            mod_val = self.shift_bit_mod(mod_val);
        }
        var cancel_val = self.mod(byte);
        cancel_val = self.shift_left(cancel_val, degree);
        return self.orr(mod_val, cancel_val);
    });

}




/**
 *
 * 32bit
 *
 * the following functions handle polynoms with 1 words of 32-bit.
 * these are capable of representing maximum degree of 31.
 * the code is therefore optimized to handle exactly one word.
 *
 */


function xor_32bit(a, b) {
    return a ^ b;
}

function orr_32bit(a, b) {
    return a | b;
}

function shift_left_32bit(a, s) {
    return a << s;
}

function shift_right_32bit(a, s) {
    return a >>> s;
}

Poly.prototype.mod_32bit = function(a) {
    return mod_32bit(a, this.val, this.degree);
};

Poly.prototype.shift_bit_mod_32bit = function(a) {
    var high = a & this.high_bit;
    a <<= 1;
    if (high) {
        a ^= this.val;
    }
    return a;
};

Poly.prototype.shift_left_mod_32bit = function(a, s) {
    var high;
    while (s >= 8) {
        high = (a >>> this.shift_byte_mod_offset) & 0xff;
        a <<= 8;
        a ^= this.shift_byte_mod_table[high];
        s -= 8;
    }
    while (s > 0) {
        high = a & this.high_bit;
        a <<= 1;
        if (high) {
            a ^= this.val;
        }
        s -= 1;
    }
    return a;
};

Poly.prototype.shift_byte_mod_32bit = function(a, add_before, byte) {
    a ^= add_before;
    a = this.shift_left_mod_32bit(a, 8);
    a ^= byte;
    if (this.degree < 8) {
        a = mod_32bit(a, this.val, this.degree);
    }
    return a;
};


/**
 *
 * mult_mod_32bit
 *
 * calculate a * b (mod p)
 * expects: deg(a), deg(b) < deg(p).
 *
 * the calculation is done by multiplying a and b as polynoms modulo p.
 * see http://en.wikipedia.org/wiki/Finite_field_arithmetic#Rijndael.27s_finite_field
 *
 */
Poly.prototype.mult_mod_32bit = function(a, b) {
    var result = 0;
    var hb = this.high_bit;
    var val = this.val;

    while (a && b) {
        // in every stage of the loop we add (which is xor in GF) a to
        // the result if b has the lowest bit on, which means that in polynom
        // representation b(x) = ... + 1
        if (b & 1) {
            result ^= a;
        }
        // in polynom notation we now do b=b/x a=a*x (mod p).
        b >>>= 1;
        var carry = a & hb;
        a <<= 1;
        if (carry) {
            a ^= val;
        }
    }
    return result;
};


/**
 *
 * mod_32bit
 *
 * calculate a modulo p using long polynom division.
 * a must be 32-bit integer.
 *
 * NOTE: this is a general case implementation and therefore not as optimized
 * as might be possible in specific cases. for example see how mult_mod_32bit handles
 * modulo with single xor by assuming only high_bit requires handling.
 *
 * here is a long division example:
 *  w = 2
 *  p = 0x7   =       111 = x^2 + x + 1
 *  a = 0x1fc = 111111100 = x^8 + x^7 + x^6 + x^5 + x^4 + x^3 + x^2
 *  d = deg(a)-w = 6
 *	===========
 * 	  111111100 	--> result = a
 *  ^ 111			--> p << d, d=6
 * 	===========
 *	     111100 	--> result
 *  ^    111		--> p << d, d=3
 * 	===========
 *	        100		--> result
 *  ^       111		--> p << d, d=0
 * 	===========
 *	         11		--> result - a mod p
 *
 */
function mod_32bit(a, p, w) {
    // in each loop we subtract (xor) with p shifted exactly to cancel
    // the next highest bit of result, until the result degree is less than w.
    var d = deg_32bit(a) - w;
    while (d >= 0) {
        a ^= (p << d);
        d = deg_32bit(a) - w;
    }
    return a;
}


/**
 *
 * deg_32bit
 *
 * return the polynom degree of a.
 * a must be 32-bit integer.
 *
 * note that deg(0) = deg(1) = 0 because both 0 and 1 represent a
 * constant polynom of degree 0.
 *
 * more examples:
 * deg(7)=2 because 7 has the polynom form of: x^2 + x + 1
 * deg(0x1001)=12 because 0x1001 has the polynom form of: x^12 + 1
 *
 */
function deg_32bit(a) {
    var n = 0;

    // checking bits: 1111 1111 1111 1111 0000 0000 0000 0000
    if (a & 0xFFFF0000) {
        n += 16;
        a >>>= 16;
    }
    // checking bits: 0000 0000 0000 0000 1111 1111 0000 0000
    if (a & 0xFF00) {
        n += 8;
        a >>>= 8;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 1111 0000
    if (a & 0xF0) {
        n += 4;
        a >>>= 4;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 0000 1100
    if (a & 0xC) {
        n += 2;
        a >>>= 2;
    }
    // checking bits: 0000 0000 0000 0000 0000 0000 0000 0010
    if (a & 0x2) {
        n += 1;
    }
    return n;
}





/**
 *
 * 64bit
 *
 * the following functions handle polynoms with 2 words of 32-bit.
 * these are capable of representing maximum degree of 63.
 * the code is therefore optimized to handle exactly two words.
 *
 */


Poly.prototype.xor_64bit = function(a, b) {
    return [a[0] ^ b[0], a[1] ^ b[1]];
};

Poly.prototype.orr_64bit = function(a, b) {
    return [a[0] | b[0], a[1] | b[1]];
};

Poly.prototype.deg_64bit = function(a) {
    if (a[1]) {
        return deg_32bit(a[1]) + 32;
    } else {
        return deg_32bit(a[0]);
    }
};

Poly.prototype.mod_64bit = function(a) {
    if (typeof(a) === 'number') {
        a = [a, 0];
    }
    var d = this.deg_64bit(a) - this.degree;

    // in each loop we subtract (xor) with p shifted exactly to cancel
    // the next highest bit of result, until the result degree is less than deg(p).
    var p = this.val;
    var deg = this.degree;
    while (d >= 0) {
        var carry = p[0] >>> (32 - d);
        a[0] ^= p[0] << d;
        a[1] ^= (p[1] << d) | carry;
        d = this.deg_64bit(a) - deg;
    }
    return a;
};

Poly.prototype.shift_bit_mod_64bit = function(a) {
    var high = a[1] & this.high_bit;
    var carry = a[0] >>> 31;
    a[0] <<= 1;
    a[1] <<= 1;
    a[1] |= carry;
    if (high) {
        a[0] ^= this.val[0];
        a[1] ^= this.val[1];
    }
    return a;
};

Poly.prototype.shift_left_mod_64bit = function(a, s) {
    var p = this.val;
    var hb = this.high_bit;
    while (s > 0) {
        var high = a[1] & hb;
        var carry = a[0] >>> 31;
        a[0] <<= 1;
        a[1] <<= 1;
        a[1] |= carry;
        if (high) {
            a[0] ^= p[0];
            a[1] ^= p[1];
        }
        s -= 1;
    }
    return a;
};

Poly.prototype.shift_byte_mod_64bit = function(a, add_before, byte) {
    a[0] ^= add_before[0];
    a[1] ^= add_before[1];
    this.shift_left_mod_64bit(a, 8);
    a[0] ^= byte;
    return a;
};




/**
 *
 * nbit
 *
 * the following functions handle polynoms with >2 words of 32-bit.
 * these are capable of representing any degree.
 * the code is therefore optimized for the general case.
 *
 */



Poly.prototype.shift_left_nbit = function(a, s) {
    var ret = this.zero();
    var nwords = this.nwords;
    var i = 0;
    while (s >= 32) {
        s -= 32;
        i += 1;
    }
    var s_rem = 32 - s;
    var carry = 0;
    var j = 0;
    for (; i < nwords; ++i, ++j) {
        var curr = a[j] || 0;
        ret[i] = (curr << s) | carry;
        carry = curr >>> s_rem;
    }
    this.truncate_nbit(ret);
    return ret;
};

Poly.prototype.shift_right_nbit = function(a, s) {
    var ret = this.zero();
    var i = this.last_word;
    while (s >= 32) {
        s -= 32;
        i -= 1;
    }
    var s_rem = 32 - s;
    var carry = 0;
    var j = this.last_word;
    for (; i >= 0; --i, --j) {
        var curr = a[j] || 0;
        ret[i] = (curr >>> s) | carry;
        carry = curr << s_rem;
    }
    this.truncate_nbit(ret);
    return ret;
};

Poly.prototype.truncate_nbit = function(a) {
    a.length = this.nwords;
    a[this.last_word] = a[this.last_word] & this.last_word_mask;
    return a;
};

Poly.prototype.xor_nbit = function(a, b) {
    for (var i = this.last_word; i >= 0; --i) {
        a[i] ^= b[i];
    }
    return a;
};

Poly.prototype.orr_nbit = function(a, b) {
    for (var i = this.last_word; i >= 0; --i) {
        a[i] |= b[i];
    }
    return a;
};

Poly.prototype.deg_nbit = function(a) {
    var i = this.last_word;
    while (!a[i] && i > 0) i -= 1;
    return i + deg_32bit(a[i]);
};


Poly.prototype.mod_nbit = function(a, p, w) {
    if (typeof(a) === 'number') {
        var a_nbit = this.zero();
        a_nbit[0] = a;
        a = a_nbit;
    }
    var d = this.deg_nbit(a) - w;

    // in each loop we subtract (xor) with p shifted exactly to cancel
    // the next highest bit of result, until the result degree is less than w.
    while (d >= 0) {
        var p_shifted = this.shift_left_nbit(p, d);
        this.xor_nbit(a, p_shifted);
        d = this.deg_nbit(a) - w;
    }
    return a;
};

Poly.prototype.mult_nbit = function(a, b) {
    throw new Error('TODO implement');
};





/**
 *
 * init_log_table
 *
 * generate log and exp tables for the primitive polynom.
 *
 * requirements:
 * w <= 20 because it will require lots of memory.
 * p must be a primitive polynom (and not just irreducible).
 *
 */
Poly.prototype.init_log_table = function() {
    // the log & exp table keeps total of 8 bytes per element (4 in each table).
    // with more than 2^20 elements (1 M) this becomes heavy in memory.
    if (this.degree > 20) {
        return false;
    }

    var log_table = new Uint32Array(this.max + 1);
    var exp_table = new Uint32Array(this.max + 1);
    log_table[0] = undefined;
    exp_table[0] = 0;

    // the process starts from the polynom a=1 and on each step it
    // multiplies a by the polynom x, which effectively means: a<<1 mod p.
    // when p is a primitive polynom this loop will iterate through all the
    // elements of GF(2^w) in the order of exponents - 1, x, x^2, x^3, ...
    var i = 0;
    var a = 1;
    do {
        // check if a repeats previous element
        // if so it means that p is not primitive.
        if (log_table[a]) {
            console.log('polynom not primitive', this.toString());
            return false;
        }
        // if (this.degree === 2) {
        //     console.log('log', a, i);
        // }
        log_table[a] = i;
        exp_table[i] = a;
        i += 1;
        a = this.mult(a, 2);
    } while (a !== 1);

    this.log_table = log_table;
    this.exp_table = exp_table;
    return true;
};


/**
 * calculate a * b in GF(2^w) using the log and exp tables.
 * using the formula: a * b = exp( log(a) + log(b) )
 */
Poly.prototype.mult_with_log = function(a, b) {
    if (!a || !b) {
        return 0;
    }
    var l = this.log_table[a] + this.log_table[b];
    if (l >= this.max) {
        l -= this.max;
    }
    return this.exp_table[l];
};


/**
 * calculate a / b in GF(2^w) using the log and exp tables.
 * using the formula: a / b = exp( log(a) - log(b) )
 */
Poly.prototype.div_with_log = function(a, b) {
    if (!a) {
        return 0;
    }
    if (!b) {
        return undefined;
    }
    var l = this.log_table[a] - this.log_table[b];
    if (l < 0) {
        l += this.max;
    }
    return this.exp_table[l];
};

/**
 * find the inverse of a using: exp( log(a) + log(a^-1) ) = 1
 * so log(a^-1) = 2^w - log(a)
 */
Poly.prototype.inverse_with_log = function(a) {
    if (!a) {
        return undefined;
    }
    var l = this.max - this.log_table[a] + 1;
    return this.exp_table[l];
};

Poly.prototype.log_lookup = function(a) {
    return this.log_table[a];
};

Poly.prototype.exp_lookup = function(l) {
    return this.exp_table[l];
};






function hex_str(num) {
    var s;
    if (num < 0) {
        s = (0xFFFFFFFF + num + 1).toString(16);
    } else {
        s = num.toString(16);
    }
    return '00000000'.slice(s.length) + s;
}

Poly.prototype.toString = function() {
    if (this.nwords <= 1) {
        return 'Poly(' + this.degree + '): ' + hex_str(this.val);
    } else {
        return 'Poly(' + this.degree + '): ' + _.map(this.val, function(v) {
            return hex_str(v);
        }).reverse().join('');
    }
};





/**
 *
 * Primitive polynom per degree
 *
 * primitive polynoms are implicitely irreducible, but can also be used
 * to create log tables (see init_log_table).
 *
 * also there is a preference for trinoms which have just 3 bits turned on.
 *
 * http://web.eecs.utk.edu/~plank/plank/papers/CS-07-593/primitive-polynomial-table.txt
 *
 */
Poly.PRIMITIVES = {
    2: [2, 1, 0],
    3: [3, 1, 0],
    4: [4, 1, 0],
    5: [5, 2, 0],
    6: [6, 1, 0],
    7: [7, 1, 0],
    8: [8, 4, 3, 2, 0],
    9: [9, 4, 0],
    10: [10, 3, 0],
    11: [11, 2, 0],
    12: [12, 6, 4, 1, 0],
    13: [13, 4, 3, 1, 0],
    14: [14, 5, 3, 1, 0],
    15: [15, 1, 0],
    16: [16, 5, 3, 2, 0],
    17: [17, 3, 0],
    18: [18, 5, 2, 1, 0],
    19: [19, 5, 2, 1, 0],
    20: [20, 3, 0],
    21: [21, 2, 0],
    22: [22, 1, 0],
    23: [23, 5, 0],
    24: [24, 4, 3, 1, 0],
    25: [25, 3, 0],
    26: [26, 6, 2, 1, 0],
    27: [27, 5, 2, 1, 0],
    28: [28, 3, 0],
    29: [29, 2, 0],
    30: [30, 6, 4, 1, 0],
    31: [31, 3, 0],
    32: [32, 7, 5, 3, 2, 1, 0],
    63: [63, 1, 0],
};
